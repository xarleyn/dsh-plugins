import type { Context } from "@deepseek-ai/cordis";
import type { PreToolDecision } from "@deepseek-ai/dsh-tools";
import type { QaApprovalExecution } from "../approvals.js";
import type { QaSessionOwnership } from "../session-ownership.js";

/** The one QA tool whose every call is parked for the operator. */
export const QA_FILE_DELETE_TOOL = "file_delete";

/**
 * Why the gate answers `ask` before the chain can decide alone. The card the
 * operator reads shows this verbatim, so it is written in the language of the
 * surface rather than in the language of the tool chain.
 */
export const QA_FILE_DELETE_ASK_REASON =
  "Удаление файла рабочего каталога требует подтверждения оператора.";

/**
 * Why the gate answers `deny` — not `ask` — for a delegated caller. A child has
 * no one to confirm to it: its card would sit over the parent's composer and
 * stop the parent turn until a person answers something they were never asked
 * about. Deleting a file is not a step a delegation was ever given, so the call
 * is refused where it is raised, and the reason tells the child to report
 * instead of trying again.
 */
export const QA_FILE_DELETE_DELEGATED_DENY_REASON =
  "a delegated call cannot delete a workspace file: no operator can confirm it. Report the file that is in the way instead of removing it";

/**
 * The inner half of `file_delete`'s safety: the decision that composes the
 * approval flow around one destructive tool.
 *
 * Installed WITHOUT `prepend`, deliberately. The approval gate sits outside
 * every other `tools/pre-execute` listener and resolves the decision the rest
 * of the chain produced — an `ask` from an inner gate is what it parks for
 * the operator. This listener is that inner gate: for a `file_delete` call
 * from an attested QA session it answers `ask` on its own, without asking
 * the chain, so the interactive approval card appears for every deletion,
 * whatever the deployment's other policies would have said. The operator's
 * answer becomes the decision, and on a deployment with
 * `interaction.approvals: blocked` the approval gate keeps its fail-closed
 * behavior and refuses the call — nothing is ever deleted without a person.
 *
 * Any other tool, and any caller this deployment did not attest, is handed
 * back to the chain untouched. A delegated child of an attested chat is the one
 * attested caller that gets no card: it is refused here, on the name, whatever
 * the deployment's approval mode is — the same refusal the answer reviewer of a
 * stand needed before its parent turn could end.
 */
export class QaFileDeleteGate {
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly ownership: QaSessionOwnership,
  ) {}

  /** Sit inside the approval gate; registration order is the composition. */
  install(): void {
    this.ownership.install(this.ctx);
    this.disposers.push(
      this.ctx.on("tools/pre-execute", (execution, next) =>
        this.handle(execution, next),
      ),
    );
  }

  /** Detach the listener. Wired as an effect, like every other gate. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private async handle(
    execution: QaApprovalExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> {
    if (execution.name !== QA_FILE_DELETE_TOOL) return next();
    const root = this.rootOf(execution);
    if (root === undefined) return next();
    if (root.sessionId !== root.ownerSessionId) {
      return { kind: "deny", reason: QA_FILE_DELETE_DELEGATED_DENY_REASON };
    }
    return { kind: "ask", reason: QA_FILE_DELETE_ASK_REASON };
  }

  /**
   * The attested chat a call belongs to and the session that made it, delegated
   * children included — the same ownership service the approval gate reads, so
   * one chat is parked under exactly one surface. The two differ for a child,
   * and a child is the caller that cannot be confirmed by anyone.
   */
  private rootOf(
    execution: QaApprovalExecution,
  ): { sessionId: string; ownerSessionId: string } | undefined {
    const session = execution.agent?.session;
    if (session === undefined) return undefined;
    const ownerSessionId = String(session.id);
    const sessionId = this.ownership.rootOf(ownerSessionId);
    if (sessionId === undefined) return undefined;
    return { sessionId, ownerSessionId };
  }
}
