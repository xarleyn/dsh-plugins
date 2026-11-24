import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import {
  DEFAULT_TOOL_LOOP_RULES,
  type ToolLoopRule,
} from "./shared/tool-loop-rules.js";
import {
  QA_MODEL_BUDGET_STOP,
  QA_MODEL_TIMEOUT_STOP,
  QA_TOOL_LOOP_STOP,
} from "./shared/tool-loop-stop.js";
import { ToolLoopTurn } from "./tool-loop-turn.js";

const WRAP_UP =
  "Finish this turn now with a short user-facing answer. Use only the evidence already collected, say what is missing, and do not call tools.";
const CLOSED_TOOLS =
  "This turn is closing. Write the answer using the available evidence.";

interface ModelBudget {
  readonly attempts: number;
  readonly outputTokens: number;
  readonly attemptMs: number;
  readonly closingMs: number;
}

interface ToolLoopOptions {
  readonly budget?: ModelBudget;
  readonly rules?: () => readonly ToolLoopRule[];
}

const DEFAULT_BUDGET: ModelBudget = {
  attempts: 64,
  outputTokens: 64_000,
  attemptMs: 180_000,
  closingMs: 30_000,
};

type ClosingReason = typeof QA_TOOL_LOOP_STOP | typeof QA_MODEL_BUDGET_STOP;

interface TurnState {
  readonly turn: number;
  readonly signal: AbortSignal;
  readonly repeats: ToolLoopTurn;
  step: number;
  requests: number;
  outputTokens: number;
  closing?: ClosingReason;
  closingMessage?: string;
  closingStep?: number;
  stream?: {
    id: string;
    timer: ReturnType<typeof setTimeout>;
    outputTokens: number;
    hasAnswerOrCall?: boolean;
  };
}

function clearStream(state: TurnState): void {
  if (state.stream === undefined) return;
  clearTimeout(state.stream.timer);
  delete state.stream;
}

function stop(
  agent: Agent,
  state: TurnState,
  reason: ClosingReason | typeof QA_MODEL_TIMEOUT_STOP,
): void {
  clearStream(state);
  if (!state.signal.aborted)
    agent.cancel({ kind: "hook", reason }, { keepInbox: true });
}

/** Scoped to QA-owned agents and their delegated sessions. */
export function installQaToolLoop(
  ctx: Context,
  owns: (agent: Agent) => boolean,
  {
    budget = DEFAULT_BUDGET,
    rules = () => DEFAULT_TOOL_LOOP_RULES,
  }: ToolLoopOptions = {},
): () => void {
  const turns = new Map<Session, TurnState>();
  const find = (exec: Readonly<ToolExecution>) =>
    exec.agent === undefined ? undefined : turns.get(exec.agent.session);
  const overBudget = (state: TurnState) =>
    state.requests >= budget.attempts ||
    state.outputTokens >= budget.outputTokens;
  const forget = (agent: Agent) => {
    const state = turns.get(agent.session);
    if (state !== undefined) clearStream(state);
    turns.delete(agent.session);
  };

  const disposers = [
    ctx.on(
      "agent/pre-step",
      async ({ agent, signal, turn, step }, next) => {
        const decision = await next();
        if (decision.kind === "reject" || signal.aborted || !owns(agent))
          return decision;

        let state = turns.get(agent.session);
        if (
          state?.turn !== turn ||
          decision.messages.some((message) => message.source.kind === "user")
        ) {
          forget(agent);
          state = {
            turn,
            signal,
            step,
            requests: 0,
            outputTokens: 0,
            repeats: new ToolLoopTurn(rules()),
          };
          turns.set(agent.session, state);
        }
        state.step = step;
        if (state.closingStep !== undefined) {
          stop(agent, state, state.closing ?? QA_MODEL_BUDGET_STOP);
          return { kind: "reject" };
        }
        if (overBudget(state)) state.closing ??= QA_MODEL_BUDGET_STOP;

        const messages =
          state.closing !== undefined
            ? [state.closingMessage, WRAP_UP].filter(
                (text) => text !== undefined,
              )
            : state.repeats.takeReminders();
        if (messages.length === 0) return decision;
        const text = messages.join("\n\n");
        if (state.closing !== undefined) state.closingStep = step;
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createUserMessage({
              content: [{ type: "text", text }],
              source: {
                kind: "qa-notes",
                form: "snapshot",
                sections: [{ name: "dsh-qa-surface:tool-loop", text }],
              },
            }),
          ],
        };
      },
      { global: true },
    ),
    ctx.on(
      "tools/pre-execute",
      (exec, next) => {
        const state = find(exec);
        if (state === undefined) return next();
        if (state.closing !== undefined)
          return Promise.resolve({
            kind: "deny",
            reason: CLOSED_TOOLS,
          });
        const denial = state.repeats.beforeCall(exec, state.step);
        if (denial === undefined) return next();
        if (denial.finishMessage !== undefined) {
          state.closing = QA_TOOL_LOOP_STOP;
          state.closingMessage = denial.finishMessage;
        }
        return Promise.resolve({
          kind: "deny",
          reason: denial.message ?? CLOSED_TOOLS,
        });
      },
      { global: true, prepend: true },
    ),
    // Keep the closing step closed even when another gate answers allow.
    ctx.tools.guard((exec) => {
      const state = find(exec);
      return state?.closing !== undefined ? CLOSED_TOOLS : undefined;
    }),
    ctx.on(
      "tools/result",
      (exec, result) => {
        const state = find(exec);
        if (state === undefined || state.closing !== undefined) return;
        state.repeats.onResult(exec, result);
      },
      { global: true },
    ),
    ctx.on(
      "agent/assistant-stream",
      ({ agent, frame }) => {
        const state = turns.get(agent.session);
        if (state === undefined) return;
        if (frame.type === "start") {
          state.requests += 1;
          clearStream(state);
          const id = frame.attemptId;
          const timer = setTimeout(
            () => {
              if (state.stream?.id === id)
                stop(agent, state, state.closing ?? QA_MODEL_TIMEOUT_STOP);
            },
            state.closingStep === undefined
              ? budget.attemptMs
              : budget.closingMs,
          );
          timer.unref();
          state.stream = { id, timer, outputTokens: 0 };
        } else if (state.stream?.id !== frame.attemptId) {
          return;
        } else if (frame.type === "end") {
          const hasAnswerOrCall = state.stream.hasAnswerOrCall;
          state.outputTokens += state.stream.outputTokens;
          clearStream(state);
          if (hasAnswerOrCall === false && state.closing !== undefined)
            stop(agent, state, state.closing);
        } else if (frame.chunk.type === "usage") {
          state.stream.outputTokens = frame.chunk.usage.outputTokens;
        }
      },
      { global: true },
    ),
    ctx.on(
      "session/event",
      (session, event) => {
        if (event.type !== "assistant/message") return;
        const state = turns.get(session);
        if (
          state?.stream === undefined ||
          event.data.step !== state.closingStep
        )
          return;
        // The committed message precedes its terminal stream notification.
        state.stream.hasAnswerOrCall = event.data.message.content.some(
          (block) =>
            block.type === "tool-call" ||
            (block.type === "text" && block.text.trim() !== ""),
        );
      },
      { global: true },
    ),
    ctx.on(
      "agent/request-error",
      ({ agent }, next) => {
        const state = turns.get(agent.session);
        if (
          state === undefined ||
          (!overBudget(state) && state.closingStep === undefined)
        )
          return next();
        stop(agent, state, state.closing ?? QA_MODEL_BUDGET_STOP);
        return Promise.resolve(undefined);
      },
      { global: true, prepend: true },
    ),
    ctx.on(
      "agent/status",
      ({ agent, status }) => {
        if (status === "idle") forget(agent);
      },
      { global: true },
    ),
    ctx.on(
      "agent/disposed",
      ({ agent }) => {
        forget(agent);
      },
      { global: true },
    ),
  ];
  return () => {
    for (const dispose of disposers) dispose();
    for (const state of turns.values()) clearStream(state);
    turns.clear();
  };
}
