/**
 * The host entry: a Cordis service that owns the audit registry and exposes it
 * over Typert Remote.
 *
 * The service is the plugin's whole host surface. `sessionAudit` is a normal
 * cordis service, so another plugin consumes it through the optional-service
 * accessor and branches on absence — the QA Surface does exactly that, and
 * neither plugin imports the other.
 *
 * Only this file knows `@yadsh/dsh-plugin-log`; the pipeline modules take a
 * narrow logger interface so they can be tested without a Cordis context.
 */
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from "@yadsh/dsh-plugin-log";
import type { AuditSummary } from "@yadsh/dsh-audit-core";
import { Config, resolveConfig, type SessionAuditConfig } from "./config.js";
import { AuditService } from "./host/audit-service.js";
import { toUnattachedValue } from "./host/unattached.js";
import {
  emptyAuditValue,
  emptySummaryValue,
  type AuditSummaryValue,
  type SessionAuditValue,
  type UnattachedAuditValue,
} from "./types.js";

export const name = "session-audit";

/**
 * The plugin requires no other service.
 *
 * Sessions and the persisted session corpus are both optional peers: an audit
 * that names its own session needs neither, and the fallback binding path
 * degrades to "unresolved" rather than failing the plugin when they are gone.
 */
export const inject: readonly string[] = [];

export type { SessionAuditConfig } from "./config.js";
export { Config, resolveAuditRoot, resolveConfig } from "./config.js";
export type { AuditSummaryValue, SessionAuditValue } from "./types.js";
export { emptyAuditValue, emptySummaryValue } from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessionAudit: SessionAuditService;
  }
}

/** The shapes the harness' optional services are read through. */
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly unknown[]>;
}

interface LiveSessionsLike {
  list(): readonly unknown[];
}

/** Pull a session id out of a `SessionRecord` or a live `Session`. */
function sessionIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as {
    id?: unknown;
    header?: { id?: unknown };
  };
  const id = candidate.header?.id ?? candidate.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The audit registry and viewer's host half.
 *
 * The audit root is scanned once at startup and then kept current by a watcher
 * plus a reconciliation timer; nothing here is persisted, because the
 * filesystem already is (SPEC §20).
 */
export class SessionAuditService extends TypertRemoteService {
  static Config = Config;
  static inject = inject;

  private readonly logger: PluginLogger;
  private readonly service: AuditService;

  constructor(ctx: Context, config: SessionAuditConfig = {}) {
    super(ctx, "sessionAudit", { namespace: "sessionAudit" });
    this.logger = getPluginLogger({
      pluginId: "dsh-session-audit",
      consoleSink: createHostLoggerSink(ctx.logger),
    });
    ctx.effect(
      () => async () => this.logger.close(),
      "dsh-session-audit.logger",
    );

    const resolved = resolveConfig(config);
    const logger: PluginLogger = this.logger;
    this.service = new AuditService({
      config: resolved,
      logger: {
        debug: (event, fields) => logger.debug(event, fields),
        info: (event, fields) => logger.info(event, fields),
        warn: (event, fields) => logger.warn(event, fields),
      },
      listSessionIds: () => this.listSessionIds(),
    });

    if (resolved.enabled) {
      ctx.effect(() => {
        void this.service.start().catch((error: unknown) => {
          this.logger.warn("audit.start.failed", { error: describe(error) });
        });
        return () => {
          void this.service.stop().catch((error: unknown) => {
            this.logger.warn("audit.stop.failed", { error: describe(error) });
          });
        };
      }, "dsh-session-audit: registry");
    } else {
      this.logger.info("plugin.ready", { enabled: false });
    }
  }

  /** The registry, for a same-process consumer that wants more than Remote. */
  get registry(): AuditService {
    return this.service;
  }

  // -- Remote surface (SPEC §31) -------------------------------------------

  /** The cheap summary: one map lookup, no file I/O (SPEC §32). */
  @Remote("summary")
  summary(sessionId: string): AuditSummaryValue {
    const record = this.service.registry.activeFor(sessionId);
    if (record?.summary === undefined) return emptySummaryValue(sessionId);
    return toSummaryValue(record.summary, true);
  }

  /** Every audit bound to a session, newest first. */
  @Remote("audits")
  audits(sessionId: string): AuditSummaryValue[] {
    const values: AuditSummaryValue[] = [];
    for (const record of this.service.registry.listFor(sessionId)) {
      if (record.status !== "ready" || record.summary === undefined) continue;
      values.push(toSummaryValue(record.summary, false));
    }
    return values;
  }

  /**
   * The audits no session view can show, newest first.
   *
   * This is the one answer to "the audit is in the root and nothing shows it":
   * an artefact no session claims, or a directory that is not a readable audit
   * yet, is listed here instead of being silently absent everywhere (SPEC
   * §2.3). It carries codes rather than messages, because the messages name
   * paths on the host.
   */
  @Remote("unattached")
  unattached(): UnattachedAuditValue[] {
    return this.service.registry.unattached().map(toUnattachedValue);
  }

  /** The full audit: summary, raw analysis text and report text (SPEC §33). */
  @Remote("audit")
  async audit(sessionId: string): Promise<SessionAuditValue> {
    const record = this.service.registry.activeFor(sessionId);
    if (record?.summary === undefined) return emptyAuditValue(sessionId);

    const loaded = await this.service.getSessionAudit(sessionId);
    if (loaded === null) return emptyAuditValue(sessionId);

    return {
      available: true,
      summary: toSummaryValue(loaded.summary, true),
      analysisJson: await this.readOrEmpty(record.auditId, "analysis"),
      report: await this.readOrEmpty(record.auditId, "report"),
    };
  }

  /** One audit's report text, by id. */
  @Remote("report")
  report(auditId: string): Promise<string> {
    return this.readOrEmpty(auditId, "report");
  }

  /** One audit's `analysis.json` text, by id. */
  @Remote("analysis")
  analysis(auditId: string): Promise<string> {
    return this.readOrEmpty(auditId, "analysis");
  }

  // -- internals -----------------------------------------------------------

  private async readOrEmpty(
    auditId: string,
    which: "analysis" | "report",
  ): Promise<string> {
    const text =
      which === "analysis"
        ? await this.service.readAnalysisJson(auditId)
        : await this.service.readReport(auditId);
    return text ?? "";
  }

  /**
   * The harness' session ids, through whichever service is present.
   *
   * `sessionQuery` covers the persisted corpus as well as the live sessions
   * and is what prefix resolution needs; `sessions` alone is the live-only
   * fallback. Neither being present is not an error — it only costs the
   * fallback binding path.
   */
  private async listSessionIds(): Promise<readonly string[]> {
    const query = ctxGet<SessionQueryLike>(this.ctx, "sessionQuery");
    if (query?.listSessions !== undefined) {
      const records = await query.listSessions();
      return records.map(sessionIdOf).filter((id): id is string => id !== null);
    }

    const live = ctxGet<LiveSessionsLike>(this.ctx, "sessions");
    if (live?.list !== undefined) {
      return live
        .list()
        .map(sessionIdOf)
        .filter((id): id is string => id !== null);
    }

    return [];
  }
}

/** Read an optional service without assuming it exists or is typed. */
function ctxGet<T>(ctx: Context, key: string): T | undefined {
  const getter = (ctx as unknown as { get?: (name: string) => unknown }).get;
  if (typeof getter !== "function") return undefined;
  const value = getter.call(ctx, key);
  return value === undefined || value === null ? undefined : (value as T);
}

function toSummaryValue(
  summary: AuditSummary,
  available: boolean,
): AuditSummaryValue {
  return {
    available,
    auditId: summary.auditId,
    sessionId: summary.sessionId,
    verdict: summary.verdict ?? "",
    outcomeStatus: summary.outcomeStatus ?? "",
    evidenceLevel: summary.evidenceLevel ?? "",
    model: summary.model ?? "",
    agentPreset: summary.agentPreset ?? "",
    toolCalls: summary.toolCalls ?? -1,
    toolErrors: summary.toolErrors ?? -1,
    critical: summary.findings.critical,
    major: summary.findings.major,
    minor: summary.findings.minor,
    observation: summary.findings.observation,
    other: summary.findings.other,
    schemaVersion: summary.schemaVersion ?? -1,
    modifiedAt: summary.modifiedAt,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default SessionAuditService;
