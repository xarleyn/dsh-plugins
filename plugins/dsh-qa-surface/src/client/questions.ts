import type { QaPendingQuestion, QaQuestionAnswerItem } from "../types.js";
import type { QaQuestionApi } from "./types.js";

/** What one write against a parked request answers with. */
type QaQuestionWriteResult =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly error: unknown };

/**
 * The operator's side of a parked `ask_user_question` call.
 *
 * Like a parked approval, the request lives on the Host: it survives a reload,
 * and the surface learns about it by asking while a turn runs. Unlike an
 * approval, an answer is a whole form — every question of the request, with the
 * operator's selections and free text — so the bridge forwards the form and
 * re-reads the list afterwards.
 */
export class QaHostQuestionBridge {
  private questions: readonly QaPendingQuestion[] = [];
  private signature = "";
  private refreshing = false;
  private answering = false;
  /** Bumped on reset so a stale in-flight response never lands. */
  private generation = 0;

  constructor(private readonly questionApi: QaQuestionApi | undefined) {}

  /** Leave the chat: a chat switch drops the previous chat's requests. */
  reset(): void {
    this.generation += 1;
    this.questions = [];
    this.signature = "";
    this.refreshing = false;
    this.answering = false;
  }

  /** The last list this bridge saw; empty when the deployment refuses them. */
  list(): readonly QaPendingQuestion[] {
    return this.questions;
  }

  /** Whether this page can ask the Host about questions at all. */
  get available(): boolean {
    return this.questionApi !== undefined;
  }

  /**
   * Re-read the chat's pending questions; a changed list republishes through
   * the callback. Overlapping calls coalesce, and a response that outlives its
   * chat is dropped.
   */
  async refresh(
    sessionId: string,
    token: string,
    onChanged: () => void,
  ): Promise<void> {
    const api = this.questionApi;
    if (api === undefined || this.refreshing) return;
    const generation = this.generation;
    this.refreshing = true;
    try {
      const result = await api.pendingQuestions(token, sessionId);
      if (!result.ok || generation !== this.generation) return;
      const signature = JSON.stringify(result.value);
      if (signature === this.signature) return;
      this.signature = signature;
      this.questions = result.value;
      onChanged();
    } catch (error) {
      // The poll is a background read: a transport failure leaves the last
      // known form on screen and the next tick retries.
      console.error("dsh-qa-surface: question poll failed", error);
    } finally {
      if (generation === this.generation) this.refreshing = false;
    }
  }

  /** Send the operator's answers to one request and re-read the list. */
  async answer(
    sessionId: string,
    token: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): Promise<void> {
    await this.settle(sessionId, token, requestId, (api) =>
      api.answerQuestion(token, sessionId, requestId, answers),
    );
  }

  /** Close one request without answering it. */
  async cancel(
    sessionId: string,
    token: string,
    requestId: string,
  ): Promise<void> {
    await this.settle(sessionId, token, requestId, (api) =>
      api.cancelQuestion(token, sessionId, requestId),
    );
  }

  /**
   * Run one write against a request, then re-read the list it belonged to. A
   * refusal is not an error: the request was already settled (the turn was
   * stopped, the call went away), so the refresh — not the write — is what the
   * surface shows.
   */
  private async settle(
    sessionId: string,
    token: string,
    requestId: string,
    write: (api: QaQuestionApi) => Promise<QaQuestionWriteResult>,
  ): Promise<void> {
    const api = this.questionApi;
    if (api === undefined || this.answering) return;
    this.answering = true;
    const generation = this.generation;
    try {
      await write(api);
      const result = await api.pendingQuestions(token, sessionId);
      if (generation !== this.generation) return;
      if (result.ok) {
        this.signature = JSON.stringify(result.value);
        this.questions = result.value;
        return;
      }
      // The list is unreadable: drop the settled request rather than leave a
      // form the operator already resolved on screen.
      this.signature = "";
      this.questions = this.questions.filter((entry) => entry.id !== requestId);
    } catch (error) {
      // A transport failure is not an answer: the form stays, and the next poll
      // reconciles it with what the Host actually holds.
      console.error("dsh-qa-surface: question answer failed", error);
    } finally {
      this.answering = false;
    }
  }
}
