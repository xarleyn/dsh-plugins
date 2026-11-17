import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionSeq, type Session } from "@deepseek-ai/dsh-session";
import type { QaAccounts } from "../accounts/store.js";
import type { QaQuestionMode } from "../questions.js";
import { qaDelegatedHeader } from "../shared/session-lineage.js";
import {
  QaNoteAdmission,
  retainedQaNotes,
} from "../shared/retained-qa-notes.js";

const NOTE = "dsh-qa-surface:integration-clarifications";
export const QA_INTEGRATION_NO_CLARIFICATIONS =
  "Clarifying questions are disabled for this integration turn. Do not call ask_user_question or ask follow-up questions in your answer. Answer from available evidence, label assumptions and missing facts, and state what cannot be determined when evidence is insufficient. Do not invent facts or bypass permission approvals.";
const ALLOWED_NOTE =
  "Clarifying questions for this turn follow the normal deployment policy. A previous integration turn's restriction no longer applies.";

/** A queued request's durable policy follows its turn and its delegated agents. */
export class QaIntegrationQuestionPolicy {
  private readonly admission: QaNoteAdmission;
  private readonly turns = new Map<
    string,
    { turn: number; mode: QaQuestionMode }
  >();
  private readonly disposers: (() => void)[];

  constructor(
    private readonly ctx: Context,
    private readonly accounts: () => QaAccounts | undefined,
    private readonly qaRoot: (id: string) => string | undefined = () =>
      undefined,
  ) {
    this.admission = new QaNoteAdmission(ctx);
    this.disposers = [
      ctx.on(
        "agent/pre-step",
        async ({ agent, turn }, next) => {
          const decision = await next();
          if (decision.kind === "reject") return decision;
          const root = this.root(agent);
          const id = String(root.id);
          if (this.accounts()?.ownerIdOf(id) === undefined) return decision;
          let state = this.turns.get(id) ?? this.recover(root);
          if (root === agent.session) {
            let mode: QaQuestionMode =
              state.turn === turn ? state.mode : "timed";
            for (const message of decision.messages) {
              mode = this.includeSource(id, mode, message.source);
            }
            state = { turn, mode };
            this.turns.set(id, state);
          }
          if (
            state.mode !== "blocked" &&
            !retainedQaNotes(agent.session, decision.messages).has(NOTE)
          )
            return this.admission.propose(agent, decision, []);
          const text =
            state.mode === "blocked"
              ? QA_INTEGRATION_NO_CLARIFICATIONS
              : ALLOWED_NOTE;
          return this.admission.propose(agent, decision, [
            { name: NOTE, text },
          ]);
        },
        { global: true },
      ),
      ctx.tools.guard((execution) =>
        execution.name === "ask_user_question" &&
        execution.agent !== undefined &&
        this.mode(execution.agent) === "blocked"
          ? QA_INTEGRATION_NO_CLARIFICATIONS
          : undefined,
      ),
      ctx.on(
        "agent/disposed",
        ({ agent }) => {
          this.turns.delete(String(agent.id));
        },
        { global: true },
      ),
    ];
  }

  mode(agent: Agent): QaQuestionMode {
    const root = this.root(agent);
    const knownRoot = this.qaRoot(String(agent.session.id));
    if (knownRoot !== undefined && qaDelegatedHeader(root.header))
      return "blocked";
    const state = this.turns.get(String(root.id)) ?? this.recover(root);
    return state.mode;
  }

  /** The strictest token wins. Browser input has no stored integration policy. */
  private includeSource(
    sessionId: string,
    mode: QaQuestionMode,
    source: object,
  ): QaQuestionMode {
    if (
      mode === "blocked" ||
      !("rpcId" in source) ||
      typeof source.rpcId !== "string"
    )
      return mode;
    const allowed = this.accounts()?.integrationRequestPolicy(
      sessionId,
      source.rpcId,
    );
    if (allowed === undefined) return mode;
    return allowed ? "untimed" : "blocked";
  }

  private root(agent: Agent): Session {
    let session = agent.session;
    const seen = new Set<string>();
    while (
      qaDelegatedHeader(session.header) &&
      session.header.parentSession !== undefined
    ) {
      if (seen.has(String(session.id))) break;
      seen.add(String(session.id));
      const parent = this.ctx.sessions.get(session.header.parentSession);
      if (parent === undefined) break;
      session = parent;
    }
    return session;
  }

  /** Recover after a plugin reload from consumed messages, never queued future input. */
  private recover(session: Session): { turn: number; mode: QaQuestionMode } {
    let mode: QaQuestionMode = "timed";
    let turn = 0;
    for (let seq = Number(session.seq) - 1; seq >= 0; seq--) {
      const event = session.eventAt(SessionSeq(seq));
      if (event?.type === "turn/start") {
        turn = event.data.turn;
        break;
      }
      if (event?.type !== "user/message") continue;
      mode = this.includeSource(String(session.id), mode, event.data.source);
    }
    const state = { turn, mode };
    this.turns.set(String(session.id), state);
    return state;
  }

  dispose(): void {
    for (const stop of this.disposers) stop();
    this.turns.clear();
    this.admission.dispose();
  }
}
