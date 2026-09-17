import { randomUUID } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { QaSessionOwnership } from "./session-ownership.js";
import type {
  QaPendingQuestion,
  QaPendingQuestionItem,
  QaQuestionAnswerItem,
} from "./types.js";

/**
 * The harness user-questions contract this seam reads and writes, declared
 * structurally on purpose: the plugin neither mounts the service nor depends on
 * its package, so it stays loadable in a deployment that composes no questions
 * at all. Shapes follow `@deepseek-ai/dsh-user-questions` `src/types.ts` at the
 * tested harness release (`AskUserQuestionItem` / `AskUserQuestionAnswer`).
 */
export interface QaQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface QaQuestionItem {
  readonly id: string;
  readonly question: string;
  readonly detail?: string;
  readonly header?: string;
  readonly options?: readonly QaQuestionOption[];
  readonly multiSelect?: boolean;
}

export interface QaQuestionRequest {
  readonly questions: readonly QaQuestionItem[];
  readonly agent?: Agent;
  readonly signal?: AbortSignal;
}

/** What the answerer waterfall accepts as its value. */
export interface QaQuestionAnswer {
  readonly answers: readonly QaQuestionAnswerItem[];
}

/**
 * Why a parked request stopped waiting without an answer. The operator closing
 * the form is the only deliberate one; the rest are the harness taking the
 * question away — the turn's signal aborted, the agent stopped running, the
 * agent was disposed, or this plugin unloaded mid-wait.
 */
type QaQuestionCancelReason = "operator" | "aborted" | "idle" | "disposed";

type QaQuestionOutcome =
  | { readonly kind: "answered"; readonly answer: QaQuestionAnswer }
  | { readonly kind: "cancelled"; readonly reason: QaQuestionCancelReason };

interface PendingEntry {
  readonly view: QaPendingQuestion;
  /** The chat that owns the request: what the QA view lists it under. */
  readonly ownerSessionId: string;
  /** The agent that asked, child agents included: what stops it being live. */
  readonly agentId: string;
  settle(outcome: QaQuestionOutcome): void;
}

/** What the model reads when the deployment does not answer questions. */
export const QA_QUESTIONS_UNSUPPORTED =
  "questions are not answered in this assistant view; ask the user in plain text instead";

/**
 * The harness tool that produces these requests. A deployment that parks
 * questions still has to let the attested session call it: this plugin never
 * adds the name to a tool policy on its own.
 */
export const QA_ASK_QUESTION_TOOL = "ask_user_question";

const CANCELLED_MESSAGE =
  "the user closed the question without answering; ask in plain text instead";

/** The waterfall listener shape, since this plugin declares no event of its own. */
type QaQuestionListener = (
  request: QaQuestionRequest,
  next: () => Promise<QaQuestionAnswer>,
) => Promise<QaQuestionAnswer>;

/**
 * User questions in the QA view.
 *
 * `ask_user_question` reaches the browser through the harness answerer
 * waterfall, and the stock DSH web bundle mounts its own answerer in every
 * page. Behind the QA overlay that answerer is unreachable, so a question asked
 * of a QA chat would sit in front of nobody. This gate claims the request for
 * attested chats before the generic browser bridge sees it:
 *
 * - `interaction.questions: interactive` parks the request until the operator
 *   answers or closes it in the QA view, and the answer becomes the waterfall's
 *   value.
 * - `unsupported` (default) refuses with a reason the model can act on, rather
 *   than letting the turn stall on a card no one can see.
 *
 * Nothing is ever answered on the operator's behalf, and a request from a
 * session this deployment did not attest is handed back to the chain untouched.
 */
export class QaQuestionGate {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly interactive: () => boolean,
    private readonly ownership: QaSessionOwnership,
    private readonly logger: PluginLogger,
  ) {}

  /** Claim question requests for the chats this deployment answers. */
  install(): void {
    this.ownership.install(this.ctx);
    // The event is declared by the harness user-questions package, which this
    // plugin deliberately does not depend on; the listener shape is structural.
    const claim = this.ctx.on.bind(this.ctx) as unknown as (
      name: string,
      listener: QaQuestionListener,
      options: { readonly prepend: boolean },
    ) => () => void;
    this.disposers.push(
      claim(
        "user-questions/request",
        (request, next) => this.handle(request, next),
        { prepend: true },
      ),
    );
    this.disposers.push(
      this.ctx.on("agent/disposed", ({ agent }) => {
        this.settleOwner(String(agent.session.id), "disposed");
      }),
    );
    // A turn that ended cannot be answered into any more, whatever the request
    // arrived with. The harness hands the asking tool a signal, and a stopped
    // turn aborts it, but a request that carried none — or one whose turn went
    // idle by a path that never aborted it — would otherwise stay parked for
    // the life of the process: the operator would keep a form nobody can
    // answer, and the answer they did send would resolve a promise no one
    // awaits. The asking agent's own status is the backstop for both.
    this.disposers.push(
      this.ctx.on("agent/status", ({ agent, status }) => {
        if (status === "idle")
          this.settleAgent(String(agent.session.id), "idle");
      }),
    );
  }

  /** Questions of one chat, oldest first: what the QA view renders. */
  list(sessionId: string): readonly QaPendingQuestion[] {
    if (!this.interactive()) return [];
    return [...this.pending.values()]
      .map((entry) => entry.view)
      .filter((view) => view.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  /**
   * Apply the operator's answers; an unknown or foreign id is refused. The
   * parked request is authoritative: a label the question never offered is
   * dropped, and a free-text answer replaces the choice in a single-select
   * rather than accompanying it, so the model only ever reads a real answer.
   *
   * The payload arrives over the wire from the browser, so its shape is
   * untrusted: a non-array, a non-object entry, or a non-array/non-string
   * selection is folded into the refusal/skip semantics instead of crashing
   * the gate with a TypeError.
   */
  answer(
    sessionId: string,
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.view.sessionId !== sessionId) {
      this.logger.debug("question.refused", { sessionId, requestId });
      return false;
    }
    if (!Array.isArray(answers)) {
      this.logger.debug("question.refused", { sessionId, requestId });
      return false;
    }
    // Every question of the request is answered here, including the ones the
    // operator skipped, so the model never sees a partial form.
    const byId = new Map(
      answers
        .filter(
          (answer): answer is QaQuestionAnswerItem =>
            typeof answer === "object" &&
            answer !== null &&
            typeof answer.id === "string",
        )
        .map((answer) => [answer.id, answer]),
    );
    const settled = entry.view.questions.map((question) => {
      const given = byId.get(question.id);
      // A question the browser omitted is a skip, not a silent choice.
      if (given === undefined) return { id: question.id, selected: [] };
      const offered = new Set(question.options.map((option) => option.label));
      const selected = (Array.isArray(given.selected) ? given.selected : [])
        .filter((label): label is string => typeof label === "string")
        .filter((label) => offered.has(label));
      const custom =
        typeof given.custom === "string" ? given.custom.trim() : "";
      if (custom === "") return { id: question.id, selected };
      return question.multiSelect
        ? { id: question.id, selected, custom }
        : { id: question.id, selected: [], custom };
    });
    // The answer itself never reaches the log: only its shape does, so a
    // deployment can tell a form that was filled from one that was skipped
    // without recording anything the operator typed.
    this.logger.info("question.answered", {
      sessionId,
      requestId,
      questions: entry.view.questions.length,
      hasCustomAnswer: settled.some((answer) => answer.custom !== undefined),
    });
    entry.settle({
      kind: "answered",
      answer: { answers: settled },
    });
    return true;
  }

  /** Close a request without answering it. */
  cancel(sessionId: string, requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined || entry.view.sessionId !== sessionId) {
      this.logger.debug("question.refused", { sessionId, requestId });
      return false;
    }
    this.logger.info("question.cancelled", { sessionId, requestId });
    entry.settle({ kind: "cancelled", reason: "operator" });
    return true;
  }

  /** Detach the listener and fail every parked request. Wired as an effect. */
  dispose(): void {
    for (const entry of [...this.pending.values()])
      entry.settle({ kind: "cancelled", reason: "disposed" });
    this.pending.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private async handle(
    request: QaQuestionRequest,
    next: () => Promise<QaQuestionAnswer>,
  ): Promise<QaQuestionAnswer> {
    const session = request.agent?.session;
    if (session === undefined) {
      this.logger.debug("question.delegated", { reason: "agentless" });
      return next();
    }
    const askingId = String(session.id);
    const sessionId = this.ownership.rootOf(askingId);
    if (sessionId === undefined) {
      // Another surface's chat, or one this deployment never attested: the
      // chain keeps it, and no identifier of that chat is written here.
      this.logger.debug("question.delegated", { reason: "unowned" });
      return next();
    }
    if (!this.interactive()) {
      this.logger.info("question.unsupported", { sessionId });
      throw new Error(QA_QUESTIONS_UNSUPPORTED);
    }
    const outcome = await this.park(sessionId, askingId, request);
    if (outcome.kind === "cancelled") throw new Error(CANCELLED_MESSAGE);
    return outcome.answer;
  }

  /** Park one request until the operator answers it, or the turn ends. */
  private park(
    sessionId: string,
    agentId: string,
    request: QaQuestionRequest,
  ): Promise<QaQuestionOutcome> {
    const signal = request.signal;
    if (signal?.aborted === true)
      return Promise.resolve({ kind: "cancelled", reason: "aborted" });
    return new Promise<QaQuestionOutcome>((resolve) => {
      const id = randomUUID();
      const onAbort = () => finish({ kind: "cancelled", reason: "aborted" });
      const finish = (outcome: QaQuestionOutcome) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        // The operator's own cancel is already logged where it was decided;
        // every other ending is the harness taking the question away.
        if (outcome.kind === "cancelled" && outcome.reason !== "operator") {
          this.logger.info("question.aborted", {
            sessionId,
            requestId: id,
            reason: outcome.reason,
          });
        }
        resolve(outcome);
      };
      this.pending.set(id, {
        ownerSessionId: sessionId,
        agentId,
        view: {
          id,
          sessionId,
          questions: request.questions.map(normalizeQuestion),
          createdAt: Date.now(),
        },
        settle: finish,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.logger.info("question.claimed", {
        sessionId,
        requestId: id,
        questions: request.questions.length,
      });
    });
  }

  /** Fail the questions one session's agent owns; a disposed agent cannot ask. */
  private settleOwner(
    ownerSessionId: string,
    reason: QaQuestionCancelReason,
  ): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.ownerSessionId === ownerSessionId)
        entry.settle({ kind: "cancelled", reason });
    }
  }

  /** Fail the questions one agent parked; an idle agent cannot receive them. */
  private settleAgent(agentId: string, reason: QaQuestionCancelReason): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.agentId === agentId)
        entry.settle({ kind: "cancelled", reason });
    }
  }
}

function normalizeQuestion(question: QaQuestionItem): QaPendingQuestionItem {
  return {
    id: question.id,
    question: question.question,
    header: question.header ?? null,
    detail: question.detail ?? null,
    multiSelect: question.multiSelect === true,
    options: (question.options ?? []).map((option) => ({
      label: option.label,
      description: option.description ?? null,
    })),
  };
}
