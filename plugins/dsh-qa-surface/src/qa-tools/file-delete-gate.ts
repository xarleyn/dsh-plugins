import type { Context } from "@deepseek-ai/cordis";
import type { PreToolDecision } from "@deepseek-ai/dsh-tools";
import type { QaApprovalExecution } from "../approvals.js";
import type { QaSessionOwnership } from "../session-ownership.js";

/** The one QA tool whose every call is parked for the operator. */
export const QA_FILE_DELETE_TOOL = "file_delete";

/** Why the gate answers `ask` before the chain can decide alone. */
export const QA_FILE_DELETE_ASK_REASON =
  "deleting a workspace file requires operator confirmation";

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
 * back to the chain untouched.
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
    if (!this.attested(execution)) return next();
    return { kind: "ask", reason: QA_FILE_DELETE_ASK_REASON };
  }

  /**
   * Whether this deployment attested the chat the call belongs to, delegated
   * children included. The same ownership service the approval gate reads,
   * so one chat is parked under exactly one surface.
   */
  private attested(execution: QaApprovalExecution): boolean {
    const session = execution.agent?.session;
    if (session === undefined) return false;
    return this.ownership.rootOf(String(session.id)) !== undefined;
  }
}
