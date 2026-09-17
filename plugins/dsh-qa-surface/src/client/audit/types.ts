/**
 * The QA Surface's view of the session-audit Remote namespace.
 *
 * Declared here, structurally, rather than imported from `@yadsh/dsh-session-audit`:
 * a plugin may not depend on another plugin, and it does not need to. The
 * namespace is a wire contract, and the surface simply asks whether it is
 * there — when the audit plugin is not installed, `ctx.inject` never fires and
 * the badge and the dialog are simply absent (SPEC §48).
 */

/** The cheap per-session summary the badge reads. */
export interface QaAuditSummary {
  readonly available: boolean;
  readonly auditId: string;
  readonly sessionId: string;
  readonly verdict: string;
  readonly outcomeStatus: string;
  readonly evidenceLevel: string;
  readonly model: string;
  readonly agentPreset: string;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly observation: number;
  readonly other: number;
  readonly schemaVersion: number;
  readonly modifiedAt: string;
}

/** The full audit, as two documents and their summary. */
export interface QaSessionAudit {
  readonly available: boolean;
  readonly summary: QaAuditSummary;
  readonly analysisJson: string;
  readonly report: string;
}

/** A failed Remote result, narrowed to what the surface reports. */
interface RemoteFailure {
  readonly ok: false;
  readonly error: { readonly code: string };
}

type RemoteResult<T> = { readonly ok: true; readonly value: T } | RemoteFailure;

/** The `sessionAudit` namespace as the browser sees it. */
export interface QaAuditRemote {
  summary(sessionId: string): Promise<RemoteResult<QaAuditSummary>>;
  audit(sessionId: string): Promise<RemoteResult<QaSessionAudit>>;
}

/** The narrow surface the surface's components are handed. */
export interface QaAuditApi {
  summary(sessionId: string): Promise<QaAuditSummary>;
  audit(sessionId: string): Promise<QaSessionAudit>;
}

/** Build the facade over a mounted Remote namespace. */
export function createQaAuditApi(remote: QaAuditRemote): QaAuditApi {
  const unwrap = async <T>(
    call: () => Promise<RemoteResult<T>>,
    what: string,
  ): Promise<T> => {
    const result = await call();
    if (!result.ok) throw new Error(`${what} failed: ${result.error.code}`);
    return result.value;
  };
  return {
    summary: (sessionId) =>
      unwrap(() => remote.summary(sessionId), "sessionAudit/summary"),
    audit: (sessionId) =>
      unwrap(() => remote.audit(sessionId), "sessionAudit/audit"),
  };
}

/** The numbers the row badge shows, or `null` when there is no audit. */
export interface QaAuditMark {
  readonly verdict: string;
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly observation: number;
  readonly other: number;
}

/** Reduce a summary to the mark a row shows. */
export function auditMark(
  summary: QaAuditSummary | undefined,
): QaAuditMark | null {
  if (summary === undefined || !summary.available) return null;
  return {
    verdict: summary.verdict,
    critical: summary.critical,
    major: summary.major,
    minor: summary.minor,
    observation: summary.observation,
    other: summary.other,
  };
}
