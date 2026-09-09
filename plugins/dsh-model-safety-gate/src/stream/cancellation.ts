/**
 * Turn cancellation (design SPEC §15).
 *
 * Stopping the yield is not enough on a block: the upstream provider would
 * keep generating (and billing). The primary mechanism is
 * `agent.cancel({ kind: "hook" }, { keepInbox: true })` — the abort propagates
 * through the turn's signal into the in-flight request. Agent lookup falls
 * back to a pre-step-captured map when the registry is unavailable.
 */

/** Structural Agent surface used by the guard (testable without Cordis). */
export interface CancellableAgent {
  readonly id: string | { toString(): string };
  cancel(cause: { kind: "hook"; reason: string }, options?: { keepInbox?: boolean }): void;
}

export type AgentLookup = (sessionId: string) => CancellableAgent | undefined;

/** Cancel the active turn for `sessionId`; returns true when an agent was cancelled. */
export function cancelTurn(lookup: AgentLookup, sessionId: string | null, reason: string): boolean {
  if (sessionId === null) return false;
  const agent = lookup(sessionId);
  if (agent === undefined) return false;
  try {
    agent.cancel({ kind: "hook", reason }, { keepInbox: true });
    return true;
  } catch {
    return false;
  }
}
