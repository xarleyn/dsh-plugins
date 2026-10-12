import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq, type Session } from "@deepseek-ai/dsh-session";
import type { QaAccounts } from "../accounts/store.js";
import type { QaNotesMessageSource } from "../prompt-notes.js";
import { qaDelegatedHeader } from "../shared/session-lineage.js";

const NOTE = "dsh-qa-surface:integration-clarifications";
export const QA_INTEGRATION_NO_CLARIFICATIONS =
  "Clarifying questions are disabled for this integration turn. Do not call ask_user_question or ask follow-up questions in your answer. Answer from available evidence, label assumptions and missing facts, and state what cannot be determined when evidence is insufficient. Do not invent facts or bypass permission approvals.";
const ALLOWED_NOTE =
  "Clarifying questions for this turn follow the normal deployment policy. A previous integration turn's restriction no longer applies.";

/** A queued request's durable policy follows its turn and its delegated agents. */
export class QaIntegrationQuestionPolicy {
  private readonly turns = new Map<
    string,
    { turn: number; blocked: boolean }
  >();
  private readonly notes = new Map<string, string>();
  private readonly disposers: (() => void)[];

  constructor(
    private readonly ctx: Context,
    private readonly accounts: () => QaAccounts | undefined,
    private readonly qaRoot: (id: string) => string | undefined = () =>
      undefined,
  ) {
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
            state = {
              turn,
              blocked:
                (state.turn === turn && state.blocked) ||
                decision.messages.some((message) => {
                  const requestId = (message.source as { rpcId?: string })
                    .rpcId;
                  return (
                    requestId !== undefined &&
                    this.accounts()?.integrationClarificationsAllowed(
                      id,
                      requestId,
                    ) === false
                  );
                }),
            };
            this.turns.set(id, state);
          }
          // Refresh the note on the next turn too, so a prior restriction cannot
          // silently carry into browser input or a token which allows questions.
          const key = `${state.turn}:${state.blocked}`;
          if (this.notes.get(String(agent.id)) === key) return decision;
          this.notes.set(String(agent.id), key);
          const text = state.blocked
            ? QA_INTEGRATION_NO_CLARIFICATIONS
            : ALLOWED_NOTE;
          const source: QaNotesMessageSource = {
            kind: "qa-notes",
            form: "snapshot",
            sections: [{ name: NOTE, text }],
          };
          return {
            ...decision,
            messages: [
              ...decision.messages,
              createUserMessage({ content: [{ type: "text", text }], source }),
            ],
          };
        },
        { global: true },
      ),
      ctx.tools.guard((execution) =>
        execution.name === "ask_user_question" &&
        execution.agent !== undefined &&
        !this.allowed(execution.agent)
          ? QA_INTEGRATION_NO_CLARIFICATIONS
          : undefined,
      ),
      ctx.on(
        "agent/disposed",
        ({ agent }) => {
          this.turns.delete(String(agent.id));
          this.notes.delete(String(agent.id));
        },
        { global: true },
      ),
    ];
  }

  allowed(agent: Agent): boolean {
    const root = this.root(agent);
    const knownRoot = this.qaRoot(String(agent.session.id));
    if (knownRoot !== undefined && qaDelegatedHeader(root.header)) return false;
    const state = this.turns.get(String(root.id)) ?? this.recover(root);
    return !state.blocked;
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
  private recover(session: Session): { turn: number; blocked: boolean } {
    let blocked = false;
    let turn = 0;
    for (let seq = Number(session.seq); seq > 0; seq--) {
      const event = session.eventAt(SessionSeq(seq));
      if (event?.type === "turn/start") {
        turn = event.data.turn;
        break;
      }
      if (event?.type !== "user/message") continue;
      const requestId = (event.data.source as { rpcId?: string }).rpcId;
      if (
        requestId !== undefined &&
        this.accounts()?.integrationClarificationsAllowed(
          String(session.id),
          requestId,
        ) === false
      )
        blocked = true;
    }
    const state = { turn, blocked };
    this.turns.set(String(session.id), state);
    return state;
  }

  dispose(): void {
    for (const stop of this.disposers) stop();
    this.turns.clear();
    this.notes.clear();
  }
}
