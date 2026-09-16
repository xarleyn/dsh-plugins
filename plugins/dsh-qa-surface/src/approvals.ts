import { randomUUID } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PreToolDecision } from "@deepseek-ai/dsh-tools";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaSessionOwnership } from "./session-ownership.js";
import type { QaApprovalDecision, QaPendingApproval } from "./types.js";

/**
 * The slice of the `tools/pre-execute` execution record this gate reads. The
 * listener is owned by the plugin context, so it is unfiltered: it also wraps
 * the calls of a delegated child, whose scope chain never reaches the chat's
 * own agent context.
 */
export interface QaApprovalExecution {
  readonly name: string;
  readonly agent?: Agent;
  readonly signal?: AbortSignal;
}

/** How one parked request ended. */
type QaApprovalOutcome = QaApprovalDecision | "cancelled" | "unavailable";

interface PendingEntry {
  readonly view: QaPendingApproval;
  /** The session whose agent made the call; a child settles with its agent. */
  readonly ownerSessionId: string;
  settle(outcome: QaApprovalOutcome): void;
}

/**
 * Interactive resolution of the tool policy `ask` decision.
 *
 * A composed gate — a content classifier, a hook rule — answers `ask` for a
 * call it will not decide alone. On an attested QA agent that ask resolves
 * against the deployment's pinned `approval=never` policy, so the model is told
 * the user rejected a call the user never saw. This gate sits outside every
 * other `tools/pre-execute` listener and hands the decision to the operator
 * instead: the request is parked here, the QA view lists it over its own
 * remote, and the answer becomes the decision the chain would have produced.
 *
 * `interaction.approvals: blocked` keeps the previous fail-closed behavior —
 * the call is refused with the surface's own reason. Either way nothing is
 * approved automatically, and the allow-list, the workspace fence and the
 * read-only sandbox still run on the resolved call.
 *
 * Only sessions this deployment attested are touched. Any other session's ask
 * is handed back to the chain untouched, so an operator instance that also
 * serves ordinary chats keeps its own approval flow.
 */
export class QaApprovalGate {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly interactive: () => boolean,
    private readonly ownership: QaSessionOwnership,
    private readonly logger: PluginLogger,
  ) {}

  /** Wrap every tool call; other gates compose inside this listener. */
  install(): void {
    this.ownership.install(this.ctx);
    this.disposers.push(
      this.ctx.on(
        "tools/pre-execute",
        (execution, next) => this.handle(execution, next),
        { prepend: true },
      ),
    );
    this.disposers.push(
      this.ctx.on("agent/disposed", ({ agent }) => {
        const sessionId = String(agent.session.id);
        this.ownership.forget(sessionId);
        this.settleOwner(sessionId, "unavailable");
      }),
    );
  }

  /** Approvals of one chat, oldest first: what the QA view lists. */
  list(sessionId: string): readonly QaPendingApproval[] {
    if (!this.interactive()) return [];
    return [...this.pending.values()]
      .map((entry) => entry.view)
      .filter((view) => view.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  /** Apply the operator's answer; an unknown or foreign id is refused. */
  answer(
    sessionId: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.view.sessionId !== sessionId) return false;
    this.logger.info("approval.decided", {
      sessionId,
      toolName: entry.view.toolName,
      decision,
    });
    entry.settle(decision);
    return true;
  }

  /** Detach the listener and fail every parked request. Wired as an effect. */
  dispose(): void {
    for (const entry of [...this.pending.values()]) {
      entry.settle("unavailable");
    }
    this.pending.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private async handle(
    execution: QaApprovalExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> {
    const owner = this.ownerOf(execution);
    if (owner === undefined) return next();
    const decision = await next();
    if (decision.kind !== "ask") return decision;
    if (!this.interactive()) {
      this.logger.info("approval.blocked", {
        sessionId: owner.sessionId,
        toolName: execution.name,
      });
      return {
        kind: "deny",
        reason: `tool "${execution.name}" requires approval, but approval interactions are unavailable in QA`,
      };
    }
    const outcome = await this.request(owner, execution, decision.reason);
    return this.resolve(execution.name, outcome);
  }

  /**
   * The chat a call belongs to, when this deployment attested it. A child of an
   * attested chat answers under the chat the operator is looking at.
   */
  private ownerOf(
    execution: QaApprovalExecution,
  ):
    | { sessionId: string; ownerSessionId: string; delegated: boolean }
    | undefined {
    const session = execution.agent?.session;
    if (session === undefined) return undefined;
    const ownerSessionId = String(session.id);
    const sessionId = this.ownership.rootOf(ownerSessionId);
    if (sessionId === undefined) return undefined;
    return {
      sessionId,
      ownerSessionId,
      delegated: sessionId !== ownerSessionId,
    };
  }

  /** Park one call until the operator answers, the turn is cancelled, or … */
  private request(
    owner: { sessionId: string; ownerSessionId: string; delegated: boolean },
    execution: QaApprovalExecution,
    reason: string | undefined,
  ): Promise<QaApprovalOutcome> {
    const signal = execution.signal;
    if (signal?.aborted === true) return Promise.resolve("cancelled");
    return new Promise<QaApprovalOutcome>((resolve) => {
      const id = randomUUID();
      const onAbort = () => finish("cancelled");
      const finish = (outcome: QaApprovalOutcome) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      this.pending.set(id, {
        ownerSessionId: owner.ownerSessionId,
        view: {
          id,
          sessionId: owner.sessionId,
          toolName: execution.name,
          reason: reason ?? null,
          createdAt: Date.now(),
          delegated: owner.delegated,
        },
        settle: finish,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.logger.info("approval.pending", {
        sessionId: owner.sessionId,
        toolName: execution.name,
        delegated: owner.delegated,
        reason,
      });
    });
  }

  private resolve(
    toolName: string,
    outcome: QaApprovalOutcome,
  ): PreToolDecision {
    switch (outcome) {
      case "allowed-once":
        return { kind: "allow" };
      case "rejected":
        return {
          kind: "deny",
          reason: `the QA user rejected tool "${toolName}"`,
        };
      case "cancelled":
        return {
          kind: "deny",
          reason: `approval for tool "${toolName}" was cancelled before the QA user answered`,
        };
      case "unavailable":
        return {
          kind: "deny",
          reason: `tool "${toolName}" requires approval, but its QA approval request is gone`,
        };
    }
  }

  /** Fail the requests one session's agent owns; a child never holds the chat. */
  private settleOwner(
    ownerSessionId: string,
    outcome: QaApprovalOutcome,
  ): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.ownerSessionId === ownerSessionId) entry.settle(outcome);
    }
  }
}
