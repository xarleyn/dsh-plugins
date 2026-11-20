import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type {
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { QA_MODEL_SELECTION_REFUSED } from "./access/model-choices.js";
import {
  QA_MODEL_BUDGET_STOP,
  QA_MODEL_TIMEOUT_STOP,
  QA_TOOL_LOOP_STOP,
} from "./shared/tool-loop-stop.js";

const CATALOG = "qa_list_subagent_models";
const REPEAT =
  "The subagent model catalog has returned the same result twice. Use the earlier result. Choose a different action or answer with the evidence already collected.";
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
  step: number;
  requests: number;
  outputTokens: number;
  catalogStep?: number;
  catalogCall?: string;
  lastResult?: string;
  identicalResults: number;
  reminder: boolean;
  blockedAt?: number;
  refreshUsed: boolean;
  closing?: ClosingReason;
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

function resultKey(result: ToolExecutionResult): string | undefined {
  return result.isError
    ? JSON.stringify([result.error.info?.code, result.error.message])
    : typeof result.value === "string"
      ? result.value
      : undefined;
}

/** Scoped to QA agents. Only this read-only, parameterless catalog has a repeat policy. */
export function installQaToolLoop(
  ctx: Context,
  owns: (agent: Agent) => boolean,
  budget: ModelBudget = DEFAULT_BUDGET,
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
            identicalResults: 0,
            reminder: false,
            refreshUsed: false,
          };
          turns.set(agent.session, state);
        }
        state.step = step;
        if (state.closingStep !== undefined) {
          stop(agent, state, state.closing ?? QA_MODEL_BUDGET_STOP);
          return { kind: "reject" };
        }
        if (overBudget(state)) state.closing ??= QA_MODEL_BUDGET_STOP;

        const text =
          state.closing !== undefined
            ? WRAP_UP
            : state.reminder
              ? REPEAT
              : undefined;
        state.reminder = false;
        if (text === undefined) return decision;
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
        if (exec.name !== CATALOG) {
          state.identicalResults = 0;
          state.reminder = false;
          return next();
        }
        if (state.blockedAt !== undefined || state.identicalResults >= 2) {
          if (state.blockedAt !== undefined && state.blockedAt < state.step)
            state.closing = QA_TOOL_LOOP_STOP;
          state.blockedAt ??= state.step;
          return Promise.resolve({ kind: "deny", reason: REPEAT });
        }
        // Parallel duplicates must neither run nor count as two model steps.
        if (state.catalogStep === state.step)
          return Promise.resolve({
            kind: "deny",
            reason:
              "Use the result of the catalog call already requested in this step.",
          });
        state.catalogStep = state.step;
        state.catalogCall = exec.callId;
        return next();
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
        if (
          exec.name === "qa_subagent" &&
          result.isError &&
          result.error.info?.code === QA_MODEL_SELECTION_REFUSED &&
          !state.refreshUsed
        ) {
          state.refreshUsed = true;
          state.identicalResults = 0;
          delete state.blockedAt;
        }
        if (exec.name !== CATALOG || exec.callId !== state.catalogCall) return;
        delete state.catalogCall;
        const key = resultKey(result);
        state.identicalResults =
          key !== undefined && key === state.lastResult
            ? state.identicalResults + 1
            : 1;
        if (key === undefined) delete state.lastResult;
        else state.lastResult = key;
        if (state.identicalResults === 2) state.reminder = true;
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
