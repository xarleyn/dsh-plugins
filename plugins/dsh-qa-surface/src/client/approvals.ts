import type { QaApprovalDecision, QaPendingApproval } from "../types.js";
import type { QaApprovalApi } from "./types.js";

/**
 * The operator's side of a parked tool call.
 *
 * A composed gate's `ask` is answered on the Host, so the waiting request is
 * Host state: it survives a page reload, and the surface learns about it by
 * asking rather than by receiving an event. The bridge holds the last list it
 * saw, refreshes it while a turn runs, and forwards an answer.
 */
export class QaHostApprovalBridge {
  private approvals: readonly QaPendingApproval[] = [];
  private signature = "";
  private refreshing = false;
  private answering = false;
  /** Bumped on reset so a stale in-flight response never lands. */
  private generation = 0;

  constructor(private readonly approvalApi: QaApprovalApi | undefined) {}

  /** Leave the chat: a chat switch drops the previous chat's requests. */
  reset(): void {
    this.generation += 1;
    this.approvals = [];
    this.signature = "";
    this.refreshing = false;
    this.answering = false;
  }

  /** The last list this bridge saw; empty when the deployment blocks them. */
  list(): readonly QaPendingApproval[] {
    return this.approvals;
  }

  /** Whether this page can ask the Host about approvals at all. */
  get available(): boolean {
    return this.approvalApi !== undefined;
  }

  /**
   * Re-read the chat's pending requests; a changed list republishes through the
   * callback. Overlapping calls coalesce, and a response that outlives its chat
   * is dropped.
   */
  async refresh(
    sessionId: string,
    token: string,
    onChanged: () => void,
  ): Promise<void> {
    const api = this.approvalApi;
    if (api === undefined || this.refreshing) return;
    const generation = this.generation;
    this.refreshing = true;
    try {
      const result = await api.pendingApprovals(token, sessionId);
      if (!result.ok || generation !== this.generation) return;
      const signature = JSON.stringify(result.value);
      if (signature === this.signature) return;
      this.signature = signature;
      this.approvals = result.value;
      onChanged();
    } catch (error) {
      // The poll is a background read: a transport failure leaves the last
      // known list on screen and the next tick retries.
      console.error("dsh-qa-surface: approval poll failed", error);
    } finally {
      if (generation === this.generation) this.refreshing = false;
    }
  }

  /**
   * Answer one request and re-read the list. A refusal is not an error: the
   * request was already settled (the turn was stopped, the call went away), so
   * the refresh — not the answer — is what the surface shows.
   */
  async answer(
    sessionId: string,
    token: string,
    requestId: string,
    decision: QaApprovalDecision,
  ): Promise<void> {
    const api = this.approvalApi;
    if (api === undefined || this.answering) return;
    this.answering = true;
    const generation = this.generation;
    try {
      await api.answerApproval(token, sessionId, requestId, decision);
      const result = await api.pendingApprovals(token, sessionId);
      if (generation !== this.generation) return;
      if (result.ok) {
        this.signature = JSON.stringify(result.value);
        this.approvals = result.value;
        return;
      }
      // The list is unreadable: drop the answered row rather than leave a
      // request the operator already resolved on screen.
      this.signature = "";
      this.approvals = this.approvals.filter(
        (approval) => approval.id !== requestId,
      );
    } catch (error) {
      // A transport failure is not a decision: the row stays, and the next
      // poll reconciles it with what the Host actually holds.
      console.error("dsh-qa-surface: approval answer failed", error);
    } finally {
      this.answering = false;
    }
  }
}
