/**
 * The client's view of the host service.
 *
 * Every call is wrapped so a failed Remote result becomes an exception at one
 * place: `RemoteResult` never rejects, and a component that forgot to check
 * `.ok` would render an empty audit as if it were real.
 */
import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { AuditSummaryValue, SessionAuditValue } from "../types.js";

/** The `sessionAudit` namespace as the client sees it. */
export interface SessionAuditRemote {
  summary(sessionId: string): Promise<RemoteResult<AuditSummaryValue>>;
  audits(sessionId: string): Promise<RemoteResult<AuditSummaryValue[]>>;
  audit(sessionId: string): Promise<RemoteResult<SessionAuditValue>>;
  report(auditId: string): Promise<RemoteResult<string>>;
  analysis(auditId: string): Promise<RemoteResult<string>>;
}

/** The narrow surface the audit components are handed. */
export interface AuditApi {
  /** The cheap summary for one session. */
  summary(sessionId: string): Promise<AuditSummaryValue>;
  /** The full audit for one session. */
  audit(sessionId: string): Promise<SessionAuditValue>;
}

/** Unwrap a Remote result, turning a failure into an exception. */
async function unwrap<T>(
  call: () => Promise<RemoteResult<T>>,
  what: string,
): Promise<T> {
  const result = await call();
  if (!result.ok) {
    throw new Error(`${what} failed: ${result.error.code}`);
  }
  return result.value;
}

/** Build the client-side facade over the mounted Remote namespace. */
export function createAuditApi(remote: SessionAuditRemote): AuditApi {
  return {
    summary: (sessionId) =>
      unwrap(() => remote.summary(sessionId), "sessionAudit/summary"),
    audit: (sessionId) =>
      unwrap(() => remote.audit(sessionId), "sessionAudit/audit"),
  };
}
