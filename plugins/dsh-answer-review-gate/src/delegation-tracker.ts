/**
 * Delegation tracking (`SPEC.md`, "Critical subagent lifecycle requirement").
 *
 * The gate must not review an interim turn: while background work the parent
 * owns is still running, a turn-stopping boundary is an orchestration pause,
 * not a final answer. Native runs are tracked by the Host's paired lifecycle
 * events. Legacy jobs use structured tool results and settlement notices.
 */

import type { PendingDelegation, PendingDelegationKind } from "./types.js";

/** Name of the harness delegation tool whose structured results are observed. */
export const DELEGATION_TOOL_NAME = "subagent";

/** Structured result of the delegation tool (`tool-subagent` output schema). */
export interface DelegationToolValue {
  readonly kind: "background" | "continuable" | "foreground" | "activation";
  readonly jobId?: string;
  readonly subagentId?: string;
}

/** Minimal structural view of one observed tool execution. */
export interface ObservedToolExecution {
  readonly name: string;
  readonly agent?: { readonly id: string };
}

/**
 * Pending background children per parent session id. Process-local by
 * design: Phase 1 state is ephemeral (`SPEC.md`, "Persistence / restart");
 * a restart simply re-observes new delegations.
 */
export class DelegationTracker {
  private readonly pending = new Map<string, Map<string, PendingDelegation>>();
  private readonly runs = new Map<string, Map<string, PendingDelegation>>();

  observeRun(
    parent: string,
    info: { runId: string; id: string },
    started: boolean,
    turn: number,
  ): void {
    const owned = this.runs.get(parent);
    if (!started) {
      owned?.delete(info.runId);
      if (owned?.size === 0) this.runs.delete(parent);
      return;
    }
    const active = owned ?? new Map<string, PendingDelegation>();
    active.set(info.runId, {
      id: info.id,
      kind: "continuable-subagent",
      createdAtTurn: turn,
    });
    this.runs.set(parent, active);
  }

  /**
   * Record background work from one structured tool result. Foreground runs
   * settle inside the tool call and are never tracked; non-delegation tools
   * are ignored.
   */
  observeToolResult(
    exec: ObservedToolExecution,
    result: { readonly isError: boolean; readonly value?: unknown },
    turn: number,
  ): void {
    if (
      (exec.name !== DELEGATION_TOOL_NAME && exec.name !== "qa_subagent") ||
      result.isError
    )
      return;
    const sessionId =
      exec.agent === undefined ? undefined : String(exec.agent.id);
    if (sessionId === undefined) return;
    const value = result.value as Partial<DelegationToolValue> | undefined;
    if (typeof value !== "object" || value === null) return;
    let kind: PendingDelegationKind;
    let childId: string | undefined;
    if (
      (value.kind === "continuable" || value.kind === "activation") &&
      typeof value.subagentId === "string"
    ) {
      kind = "continuable-subagent";
      childId = value.subagentId;
    } else if (value.kind === "background" && typeof value.jobId === "string") {
      kind = "background-job";
      childId = value.jobId;
    } else {
      // `foreground` settles synchronously; unknown shapes are ignored.
      return;
    }
    let owned = this.pending.get(sessionId);
    if (owned === undefined) {
      owned = new Map();
      this.pending.set(sessionId, owned);
    }
    owned.set(childId, { id: childId, kind, createdAtTurn: turn });
  }

  /**
   * Resolve settled work from one inbox insertion. Only the runtime's
   * `subagent-settled` notice settles a child; any other source — including
   * future "still pending" notices — deliberately changes nothing.
   */
  observeInboxInsert(
    sessionId: string,
    message: { readonly source?: unknown },
  ): void {
    const source = message.source as
      | { readonly kind?: unknown; readonly senderSessionId?: unknown }
      | undefined;
    if (typeof source !== "object" || source === null) return;
    if (source.kind !== "subagent-settled") return;
    const childId = source.senderSessionId;
    if (typeof childId !== "string" || childId === "") return;
    this.pending.get(sessionId)?.delete(childId);
  }

  /** Forget a session's bookkeeping entirely (agent disposed). */
  forgetSession(sessionId: string): void {
    this.pending.delete(sessionId);
    this.runs.delete(sessionId);
  }

  /** How much of the session's own background work is still outstanding. */
  pendingCount(sessionId: string): number {
    return (
      (this.pending.get(sessionId)?.size ?? 0) +
      (this.runs.get(sessionId)?.size ?? 0)
    );
  }

  /** Pending entries of one session, oldest first (diagnostics/tests). */
  entries(sessionId: string): readonly PendingDelegation[] {
    return [
      ...(this.pending.get(sessionId)?.values() ?? []),
      ...(this.runs.get(sessionId)?.values() ?? []),
    ];
  }
}
