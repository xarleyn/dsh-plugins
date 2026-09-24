/**
 * The coordinator: one place where scanning, reading, validation, resolution
 * and registration meet.
 *
 * Three behaviours here are load-bearing and easy to get wrong:
 *
 * - **The metadata gate.** A pass re-reads a file only after its size or mtime
 *   moved. Reconciliation therefore costs a directory listing in the common
 *   case, which is what makes a 30-second interval affordable (SPEC §23).
 * - **The fingerprint gate.** Bytes that changed but produced the same content
 *   are not a change: no reload, no `audit.updated`, no UI work (SPEC §26).
 * - **A transient failure never blanks a good audit.** A producer rewriting a
 *   file in place passes through an empty or half-written state; the record a
 *   user is reading stays until its replacement validates (SPEC §66).
 */
import {
  buildAuditSummary,
  getAuditSessionId,
  parseAuditAnalysis,
  validateAuditAnalysis,
  type AuditAnalysis,
  type AuditError,
  type AuditRecord,
  type AuditRegistryEvent,
  type AuditSummary,
  type SessionAudit,
  type SessionAuditProvider,
} from "@yadsh/dsh-audit-core";
import { isPathContained } from "@yadsh/dsh-audit-core/paths";
import type { ResolvedSessionAuditConfig } from "../config.js";
import { readArtifactText } from "./audit-loader.js";
import { computeFingerprint } from "./audit-fingerprint.js";
import { AuditRegistry } from "./audit-registry.js";
import { scanAuditRoot, type DiscoveredAudit } from "./audit-scanner.js";
import { SessionResolver } from "./session-resolver.js";
import { AUDIT_LOGGER_NOOP, type AuditLogger } from "./logging.js";
import { AuditWatcher } from "./audit-watcher.js";

/** What a previous pass recorded about one directory, for the gates. */
interface SeenState {
  readonly analysisSize: number | null;
  readonly analysisMtimeMs: number | null;
  readonly reportSize: number | null;
  readonly reportMtimeMs: number | null;
  /** Content identity, present only after a successful full read. */
  readonly fingerprint?: string;
}

export interface AuditServiceOptions {
  readonly config: ResolvedSessionAuditConfig;
  /** The harness' session ids; consulted only for the fallback binding path. */
  readonly listSessionIds: () => Promise<readonly string[]>;
  readonly logger?: AuditLogger;
}

/** One statistics snapshot per pass, for tests and diagnostics. */
export interface AuditRefreshStats {
  readonly scanned: number;
  readonly changed: number;
  readonly ready: number;
  readonly invalid: number;
  readonly unresolved: number;
}

export class AuditService implements SessionAuditProvider {
  /** Explicitly annotated: the Remote artifact generator walks public members. */
  readonly registry: AuditRegistry = new AuditRegistry();

  private readonly seen = new Map<string, SeenState>();
  private readonly discovered = new Map<string, string>();
  private readonly resolver: SessionResolver;
  private readonly watcher: AuditWatcher;
  private readonly logger: AuditLogger;
  private started = false;
  private refreshing = false;
  private pendingRefresh: Promise<AuditRefreshStats> | undefined;

  constructor(private readonly options: AuditServiceOptions) {
    this.logger = options.logger ?? AUDIT_LOGGER_NOOP;
    this.resolver = new SessionResolver({
      listSessionIds: options.listSessionIds,
      allowDirectoryPrefixMatch: options.config.allowDirectoryPrefixMatch,
    });
    this.watcher = new AuditWatcher({
      root: options.config.auditRoot,
      watch: options.config.watch,
      watchMode: options.config.watchMode,
      settleMs: options.config.settleMs,
      rescanIntervalMs: options.config.rescanIntervalMs,
      onRecheck: () => {
        void this.refresh().catch((error: unknown) => {
          this.logger.warn("audit.recheck.failed", { error: describe(error) });
        });
      },
      onFallback: (reason) => {
        this.logger.warn("watcher fallback activated", { reason });
      },
    });
  }

  /** Startup scan, then the watcher (SPEC §19). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.logger.info("audit root initialized", {
      root: this.options.config.auditRoot,
      watch: this.options.config.watch,
      watchMode: this.options.config.watchMode,
    });
    await this.refresh();
    // The scan is asynchronous, so a stop can land inside it. Starting the
    // watcher after that would leave a watcher nothing owns.
    if (!this.started) return;
    await this.watcher.start();
  }

  /** Stop watching and forget everything derived from the filesystem. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.watcher.stop();
    this.registry.clear();
    this.seen.clear();
    this.discovered.clear();
  }

  /**
   * One pass over the audit root.
   *
   * Concurrent callers share one pass: an event storm during a `scp -r` would
   * otherwise start a scan per event, and they would read the same
   * half-copied directory at the same time.
   */
  refresh(): Promise<AuditRefreshStats> {
    if (this.pendingRefresh !== undefined) return this.pendingRefresh;
    const run = this.runRefresh().finally(() => {
      this.pendingRefresh = undefined;
    });
    this.pendingRefresh = run;
    return run;
  }

  private async runRefresh(): Promise<AuditRefreshStats> {
    if (this.refreshing) {
      return { scanned: 0, changed: 0, ...this.registry.counts() };
    }
    this.refreshing = true;
    try {
      const { audits, warnings } = await scanAuditRoot(
        this.options.config.auditRoot,
      );
      for (const warning of warnings) {
        this.logger.warn("audit root warning", { message: warning.message });
      }

      const present = new Set<string>();
      let changed = 0;
      for (const found of audits) {
        present.add(found.name);
        if (await this.process(found)) changed += 1;
      }

      for (const auditId of this.registry.auditIds()) {
        if (present.has(auditId)) continue;
        this.registry.remove(auditId);
        this.seen.delete(auditId);
        this.discovered.delete(auditId);
        this.logger.info("audit removed", { auditId });
      }

      const counts = this.registry.counts();
      this.logger.debug("initial scan completed", {
        scanned: audits.length,
        changed,
        ...counts,
      });
      return { scanned: audits.length, changed, ...counts };
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Bring one directory's record up to date.
   * @returns whether anything was read and registered.
   */
  private async process(found: DiscoveredAudit): Promise<boolean> {
    const previous = this.seen.get(found.name);
    const next: SeenState = {
      analysisSize: found.analysis?.size ?? null,
      analysisMtimeMs: found.analysis?.mtimeMs ?? null,
      reportSize: found.report?.size ?? null,
      reportMtimeMs: found.report?.mtimeMs ?? null,
      ...(previous?.fingerprint === undefined
        ? {}
        : { fingerprint: previous.fingerprint }),
    };

    if (previous !== undefined && sameMetadata(previous, next)) return false;

    // Only half the audit has arrived. Not registered, not shown, and — if a
    // valid record exists for this id — not unmade either (SPEC §25).
    if (found.analysis === null || found.report === null) {
      this.seen.set(found.name, next);
      this.logger.debug("audit pending", {
        auditId: found.name,
        hasAnalysis: found.analysis !== null,
        hasReport: found.report !== null,
      });
      return false;
    }

    const analysisRead = await readArtifactText(
      found.analysis,
      this.options.config.maxAnalysisBytes,
      this.options.config.auditRoot,
    );
    if (!analysisRead.ok) return this.reject(found, next, [analysisRead.error]);

    const reportRead = await readArtifactText(
      found.report,
      this.options.config.maxReportBytes,
      this.options.config.auditRoot,
    );
    if (!reportRead.ok) return this.reject(found, next, [reportRead.error]);

    const fingerprint = computeFingerprint(analysisRead.text, reportRead.text);
    this.seen.set(found.name, { ...next, fingerprint });
    if (previous?.fingerprint === fingerprint) return false;

    const parsed = parseAuditAnalysis(analysisRead.text);
    if (!parsed.ok) return this.reject(found, next, parsed.errors);

    const errors: AuditError[] = [...parsed.errors];
    const declared = getAuditSessionId(parsed.analysis);
    const resolution = await this.resolver.resolve(declared, found.name);
    // The directory is compared against the session the audit is actually bound
    // to. A producer that dropped the `session-` prefix disagrees with its own
    // directory only until the resolver puts the prefix back.
    const bound =
      resolution.status === "resolved" ? resolution.sessionId : declared;
    if (
      bound !== null &&
      !SessionResolver.directoryAgreesWithSession(found.name, bound)
    ) {
      errors.push({
        code: "SESSION_ID_MISMATCH",
        message: `directory ${JSON.stringify(found.name)} does not name the session ${JSON.stringify(bound)} recorded in the analysis; the analysis wins`,
        severity: "warning",
      });
    }

    const modifiedAt = new Date(
      Math.max(found.analysis.mtimeMs, found.report.mtimeMs),
    ).toISOString();
    const discoveredAt =
      this.discovered.get(found.name) ??
      this.registry.get(found.name)?.discoveredAt ??
      new Date().toISOString();
    this.discovered.set(found.name, discoveredAt);

    if (resolution.status === "unresolved") {
      this.registry.upsert({
        auditId: found.name,
        sessionId: null,
        sourceDirectory: found.directory,
        status: "unresolved",
        schemaVersion: schemaVersionOf(parsed.analysis),
        fingerprint,
        reportPath: found.report.path,
        analysisPath: found.analysis.path,
        discoveredAt,
        modifiedAt,
        errors: [...errors, resolution.error],
      });
      this.logger.info("audit unresolved", {
        auditId: found.name,
        reason: resolution.error.code,
      });
      return true;
    }

    const summary = buildAuditSummary({
      analysis: parsed.analysis,
      auditId: found.name,
      sessionId: resolution.sessionId,
      modifiedAt,
    });
    this.registry.upsert({
      auditId: found.name,
      sessionId: resolution.sessionId,
      sourceDirectory: found.directory,
      status: "ready",
      schemaVersion: schemaVersionOf(parsed.analysis),
      fingerprint,
      summary,
      reportPath: found.report.path,
      analysisPath: found.analysis.path,
      discoveredAt,
      modifiedAt,
      errors,
    });
    this.logger.info(
      previous === undefined ? "audit discovered" : "audit updated",
      {
        auditId: found.name,
        sessionId: resolution.sessionId,
        verdict: summary.verdict ?? "",
        schemaVersion: summary.schemaVersion ?? 0,
      },
    );
    return true;
  }

  /**
   * Record a directory that cannot be read or parsed.
   *
   * When a valid record already exists for this id, the failure is logged and
   * the valid record survives: a producer writing a replacement in place must
   * not blank the audit a reader has open.
   */
  private reject(
    found: DiscoveredAudit,
    next: SeenState,
    errors: readonly AuditError[],
  ): boolean {
    this.seen.set(found.name, next);
    const existing = this.registry.get(found.name);
    if (existing !== undefined && existing.status === "ready") {
      this.logger.warn("audit invalid, previous record retained", {
        auditId: found.name,
        code: errors[0]?.code ?? "INVALID_SCHEMA",
      });
      return false;
    }

    const reason = errors[0] ?? {
      code: "INVALID_SCHEMA" as const,
      message: "the audit could not be read",
      severity: "error" as const,
    };
    this.registry.upsert({
      auditId: found.name,
      sessionId: null,
      sourceDirectory: found.directory,
      status: "invalid",
      schemaVersion: null,
      fingerprint: existing?.fingerprint ?? "",
      reportPath: found.report?.path ?? "",
      analysisPath: found.analysis?.path ?? "",
      discoveredAt:
        this.discovered.get(found.name) ??
        existing?.discoveredAt ??
        new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      errors,
    });
    this.logger.info("audit invalid", {
      auditId: found.name,
      code: reason.code,
      message: reason.message,
    });
    return true;
  }

  // -- SessionAuditProvider ------------------------------------------------

  async getSessionAuditSummary(
    sessionId: string,
  ): Promise<AuditSummary | null> {
    return this.registry.activeFor(sessionId)?.summary ?? null;
  }

  async getSessionAudit(sessionId: string): Promise<SessionAudit | null> {
    const record = this.registry.activeFor(sessionId);
    if (record === undefined) return null;
    return this.load(record);
  }

  async listSessionAudits(sessionId: string): Promise<readonly AuditSummary[]> {
    return this.registry
      .listFor(sessionId)
      .filter((record) => record.status === "ready")
      .map((record) => record.summary)
      .filter((summary): summary is AuditSummary => summary !== undefined);
  }

  subscribe(listener: (event: AuditRegistryEvent) => void): () => void {
    return this.registry.subscribe(listener);
  }

  /** The report text for one audit, or `null` when it cannot be produced. */
  async readReport(auditId: string): Promise<string | null> {
    return this.readArtifact(auditId, "report");
  }

  /** The `analysis.json` text for one audit, or `null`. */
  async readAnalysisJson(auditId: string): Promise<string | null> {
    return this.readArtifact(auditId, "analysis");
  }

  private async readArtifact(
    auditId: string,
    which: "analysis" | "report",
  ): Promise<string | null> {
    const record = this.registry.get(auditId);
    if (record === undefined) return null;
    const path = which === "analysis" ? record.analysisPath : record.reportPath;
    if (path === "" || !isPathContained(this.options.config.auditRoot, path)) {
      return null;
    }
    const read = await readArtifactText(
      { path, size: 0, mtimeMs: 0 },
      which === "analysis"
        ? this.options.config.maxAnalysisBytes
        : this.options.config.maxReportBytes,
      this.options.config.auditRoot,
    );
    return read.ok ? read.text : null;
  }

  /** Re-read one record's bytes and rebuild the semantic view from them. */
  private async load(record: AuditRecord): Promise<SessionAudit | null> {
    const [analysisText, reportText] = await Promise.all([
      this.readArtifact(record.auditId, "analysis"),
      this.readArtifact(record.auditId, "report"),
    ]);
    if (analysisText === null || reportText === null) {
      this.logger.warn("audit load failed", { auditId: record.auditId });
      return null;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(analysisText);
    } catch {
      this.logger.warn("audit load failed", {
        auditId: record.auditId,
        reason: "analysis is not valid JSON",
      });
      return null;
    }

    const validated = validateAuditAnalysis(raw);
    const analysis: AuditAnalysis = validated.ok
      ? validated.analysis
      : { kind: "unknown", schemaVersion: null };

    return {
      summary:
        record.summary ??
        buildAuditSummary({
          analysis,
          auditId: record.auditId,
          sessionId: record.sessionId ?? "",
          modifiedAt: record.modifiedAt,
        }),
      analysis,
      report: reportText,
      raw,
    };
  }
}

/** `true` when nothing about the two files' size or mtime moved. */
function sameMetadata(left: SeenState, right: SeenState): boolean {
  return (
    left.analysisSize === right.analysisSize &&
    left.analysisMtimeMs === right.analysisMtimeMs &&
    left.reportSize === right.reportSize &&
    left.reportMtimeMs === right.reportMtimeMs &&
    left.fingerprint === right.fingerprint
  );
}

function schemaVersionOf(analysis: AuditAnalysis): number | null {
  return analysis.schemaVersion;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
