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
 *   user is reading stays until its replacement validates, and it stays
 *   *readable* — the bytes it was built from are held with it (SPEC §66). That
 *   holding is bounded in total, not merely per file, and what the bound drops
 *   is the snapshot no reader asked for longest.
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

/** What a previous pass recorded about one directory, for the content gate. */
interface SeenState {
  readonly analysisSize: number | null;
  readonly analysisMtimeMs: number | null;
  readonly reportSize: number | null;
  readonly reportMtimeMs: number | null;
  /** Content identity, present only after a successful full read. */
  readonly fingerprint?: string;
}

/** The validated bytes one directory was registered from. */
interface LastGood {
  readonly analysis: string;
  readonly report: string;
  /** What the two texts cost, so the total can be kept inside the budget. */
  readonly bytes: number;
}

/**
 * How many audits' worth of full-size bytes the readers may be held for.
 *
 * The configured caps bound *one* file, and a snapshot is two of them: without
 * an aggregate, a registry that grew with every session of a long-running host
 * would hold a caps'-worth per directory — 15 MB at the defaults — until the
 * process ended. Past this many full-size audits the snapshot no reader asked
 * for longest is dropped, which costs that one audit the detail view if its
 * files then break (SPEC §66).
 */
const RETAINED_AUDITS = 2;

/**
 * Where a directory's binding stands, kept apart from its content.
 *
 * Content that has not moved is no reason to read a file again — but a binding
 * the session list settled can change while every byte stays put, so the
 * binding needs its own record of what it was settled against.
 */
interface BindingState {
  /** Whether another look at the session list could bind this directory better. */
  readonly improvable: boolean;
  /**
   * `trajectory.sessionId` as the last full pass read it.
   *
   * Re-deciding a binding needs this and the session list and nothing else, so
   * a list that moved is answered without opening the artefacts again.
   */
  readonly declaredSessionId: string | null;
  /** The corpus generation the binding was last attempted against. */
  readonly corpusGeneration: number;
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
  private readonly lastGood = new Map<string, LastGood>();
  private readonly bindings = new Map<string, BindingState>();
  private readonly discovered = new Map<string, string>();
  private readonly resolver: SessionResolver;
  private readonly watcher: AuditWatcher;
  private readonly logger: AuditLogger;
  /** What the held snapshots add up to, and the total they must stay inside. */
  private lastGoodBytes = 0;
  private readonly lastGoodBudget: number;
  /** Whether the previous pass also failed to list the corpus. */
  private corpusListingBroken = false;
  private started = false;
  private refreshing = false;
  private pendingRefresh: Promise<AuditRefreshStats> | undefined;

  constructor(private readonly options: AuditServiceOptions) {
    this.logger = options.logger ?? AUDIT_LOGGER_NOOP;
    this.lastGoodBudget =
      RETAINED_AUDITS *
      (options.config.maxAnalysisBytes + options.config.maxReportBytes);
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
    this.lastGood.clear();
    this.lastGoodBytes = 0;
    this.bindings.clear();
    this.discovered.clear();
    this.corpusListingBroken = false;
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
      // A binding the session list settled can change while no file does, so
      // the list is looked at once more whenever such a binding is still
      // unfinished. Content that has not moved still costs no read.
      if (this.hasImprovableBindings()) {
        const observed = await this.resolver.observeCorpus();
        if (observed.ok) {
          this.corpusListingBroken = false;
        } else if (!this.corpusListingBroken) {
          // Once per run of failures: the generation cannot move while the list
          // is unreadable, so every unfinished binding stays parked — and a
          // 30-second interval would otherwise repeat this line forever.
          this.corpusListingBroken = true;
          this.logger.warn("session list unavailable, bindings stay parked", {
            error: observed.error.message,
          });
        }
      }
      for (const found of audits) {
        present.add(found.name);
        if (await this.process(found)) changed += 1;
      }

      for (const auditId of this.registry.auditIds()) {
        if (present.has(auditId)) continue;
        this.registry.remove(auditId);
        this.seen.delete(auditId);
        this.forget(auditId);
        this.bindings.delete(auditId);
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
    const binding = this.bindings.get(found.name);
    const rebind = this.needsRebind(found.name);
    const next: SeenState = {
      analysisSize: found.analysis?.size ?? null,
      analysisMtimeMs: found.analysis?.mtimeMs ?? null,
      reportSize: found.report?.size ?? null,
      reportMtimeMs: found.report?.mtimeMs ?? null,
      ...(previous?.fingerprint === undefined
        ? {}
        : { fingerprint: previous.fingerprint }),
    };

    // Unmoved metadata normally closes the pass. A pending rebind does not:
    // the bytes are the same, and the session they belong to is what moved.
    if (previous !== undefined && sameMetadata(previous, next)) {
      if (!rebind) return false;
      // Re-deciding a binding needs the declared id and the session list, not
      // the artefacts, so a list that grew is answered from what this pass
      // already knows. Only a binding that lands elsewhere costs a read.
      if (
        binding !== undefined &&
        (await this.redecideBinding(found.name, binding))
      ) {
        return false;
      }
    }

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
    if (previous?.fingerprint === fingerprint && !rebind) return false;

    const parsed = parseAuditAnalysis(analysisRead.text);
    if (!parsed.ok) return this.reject(found, next, parsed.errors);

    // These are the bytes the record below describes, so they are what a reader
    // gets back. A later version that cannot be read must not cost a reader the
    // audit that was good, and a summary alone would leave the detail view
    // reading a file that no longer matches it (SPEC §66).
    this.retain(found.name, analysisRead.text, reportRead.text);

    const errors: AuditError[] = [...parsed.errors];
    const declared = getAuditSessionId(parsed.analysis);
    const resolution = await this.resolver.resolve(declared, found.name);
    this.bindings.set(found.name, {
      improvable: SessionResolver.bindingCouldImprove(resolution, declared),
      declaredSessionId: declared,
      corpusGeneration: this.resolver.corpusGeneration,
    });
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
    const before = this.registry.get(found.name);

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
      // A rebind that lands where the record already was showed nothing new.
      return !rebind || before?.status !== "unresolved";
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
    // Same bytes and the same session: the rebind confirmed the record, it did
    // not change it.
    return (
      !rebind ||
      before?.status !== "ready" ||
      before.sessionId !== resolution.sessionId ||
      before.fingerprint !== fingerprint
    );
  }

  /**
   * Whether this directory's binding has to be attempted again.
   *
   * Only a binding the session list could still improve, and only once that
   * list has actually moved since the binding was attempted.
   */
  private needsRebind(auditId: string): boolean {
    const binding = this.bindings.get(auditId);
    return (
      binding?.improvable === true &&
      binding.corpusGeneration !== this.resolver.corpusGeneration
    );
  }

  /** Whether any recorded binding is still waiting on the session list. */
  private hasImprovableBindings(): boolean {
    for (const binding of this.bindings.values()) {
      if (binding.improvable) return true;
    }
    return false;
  }

  /**
   * Decide a binding's session again against the list that moved.
   *
   * A list-decided binding is provisional (SPEC §4): the session it named by
   * prefix can gain a sibling and become ambiguous, and SPEC §4 says an
   * ambiguous prefix binds to none — so an audit must be able to *leave* a
   * session, not only arrive in one. The decision itself needs nothing but the
   * declared id and the list, which is why this runs without opening either
   * artefact.
   *
   * @returns whether the registered record already says exactly this, in which
   *   case the pass ends here; `false` sends it on to a full rebuild, where a
   *   changed binding, a new session, or a different diagnostic is written up
   *   from the artefacts themselves.
   */
  private async redecideBinding(
    auditId: string,
    binding: BindingState,
  ): Promise<boolean> {
    const record = this.registry.get(auditId);
    if (record === undefined) return false;

    const resolution = await this.resolver.resolve(
      binding.declaredSessionId,
      auditId,
    );
    const stands =
      resolution.status === "resolved"
        ? record.status === "ready" && record.sessionId === resolution.sessionId
        : record.status === "unresolved" &&
          record.sessionId === null &&
          sameDiagnostic(lastOf(record.errors), resolution.error);
    if (!stands) return false;

    this.bindings.set(auditId, {
      improvable: SessionResolver.bindingCouldImprove(
        resolution,
        binding.declaredSessionId,
      ),
      declaredSessionId: binding.declaredSessionId,
      corpusGeneration: this.resolver.corpusGeneration,
    });
    return true;
  }

  /**
   * Hold the bytes one record was registered from, inside the total budget.
   *
   * Insertion is the freshness the budget trims by: registering is what the
   * bytes are for, and {@link readArtifact} re-inserts when a reader asks, so
   * what gets dropped is the audit nobody is reading.
   */
  private retain(auditId: string, analysis: string, report: string): void {
    this.forget(auditId);
    const bytes =
      Buffer.byteLength(analysis, "utf8") + Buffer.byteLength(report, "utf8");
    this.lastGood.set(auditId, { analysis, report, bytes });
    this.lastGoodBytes += bytes;
    for (const oldest of this.lastGood.keys()) {
      if (this.lastGoodBytes <= this.lastGoodBudget) break;
      if (oldest === auditId) continue;
      // The newest is never dropped and the budget fits two of the largest
      // snapshots the caps allow, so this loop always reaches the line above.
      this.forget(oldest);
      this.logger.debug("last good snapshot dropped", {
        auditId: oldest,
        reason: "over the retention budget",
      });
    }
  }

  /** Drop one directory's held bytes and the share of the budget they cost. */
  private forget(auditId: string): void {
    const held = this.lastGood.get(auditId);
    if (held === undefined) return;
    this.lastGood.delete(auditId);
    this.lastGoodBytes -= held.bytes;
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
    // The bytes the record was registered from, when this pass still holds them.
    // Reading the paths instead would follow whatever the producer put there
    // next, and a detail view built from those would not match its summary.
    const snapshot = this.lastGood.get(auditId);
    if (snapshot !== undefined) {
      // Asking is what the bytes are kept for, so the snapshot moves to the
      // fresh end of the budget: what gets dropped is what no reader wants.
      this.lastGood.delete(auditId);
      this.lastGood.set(auditId, snapshot);
      return which === "analysis" ? snapshot.analysis : snapshot.report;
    }
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

/**
 * The diagnostic a reader is shown for an unresolved record.
 *
 * The unresolved branch appends the binding's error last, so this is that
 * error — or `undefined` for a record that somehow has none.
 */
function lastOf(errors: readonly AuditError[]): AuditError | undefined {
  return errors[errors.length - 1];
}

/** Whether a re-decided binding reports the same trouble the record already does. */
function sameDiagnostic(
  held: AuditError | undefined,
  next: AuditError,
): boolean {
  return (
    held !== undefined &&
    held.code === next.code &&
    held.message === next.message &&
    held.severity === next.severity
  );
}
