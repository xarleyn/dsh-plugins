import { setTimeout as wait } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import AgentRegistry, { type Agent } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import SessionStore, {
  SessionId,
  type TurnEndReason,
} from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import * as NativeExecutor from "@deepseek-ai/dsh-tool-executor-native";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { expect, it, onTestFinished } from "vitest";
import { QaModelSelectionError } from "../../src/access/model-choices.js";
import {
  resolveToolLoopRules,
  type ToolLoopRule,
} from "../../src/shared/tool-loop-rules.js";
import {
  QA_MODEL_BUDGET_STOP,
  QA_MODEL_TIMEOUT_STOP,
  QA_TOOL_LOOP_STOP,
} from "../../src/shared/tool-loop-stop.js";
import { installQaToolLoop } from "../../src/tool-loop.js";

const catalog = "qa_list_subagent_models";
const lookup = "demo_lookup";
const answer = "Answer based on the results.";
type Call = string | { readonly tool: string; readonly query: string };
type Action = readonly Call[] | "answer" | "empty" | "wait";

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  constructor(private readonly actions: readonly Action[]) {
    super();
  }

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request);
    const action = this.actions[this.requests.length - 1];
    if (action === undefined)
      throw new Error("Unexpected extra model request.");
    if (action === "wait") {
      const signal = request.signal!;
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      signal.throwIfAborted();
    }
    if (action === "answer") {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: answer };
      yield {
        type: "block-end",
        index: 0,
        block: { type: "text", text: answer },
      };
    } else if (typeof action !== "string") {
      for (const [index, call] of action.entries()) {
        const id = ToolCallId(`call-${this.requests.length}-${index}`);
        const name = typeof call === "string" ? call : call.tool;
        const args =
          typeof call === "string"
            ? "{}"
            : JSON.stringify({ query: call.query });
        yield { type: "block-start", index, blockType: "tool-call" };
        yield {
          type: "tool-call-delta",
          index,
          id,
          name,
          argumentsDelta: args,
        };
        yield {
          type: "block-end",
          index,
          block: { type: "tool-call", id, name, arguments: args },
        };
      }
    }
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

async function harness(
  actions: readonly Action[],
  options: {
    readonly attempts?: number;
    readonly outputTokens?: number;
    readonly attemptMs?: number;
    readonly lookupMs?: number;
    readonly lookupResults?: readonly string[];
    readonly catalogResults?: readonly string[];
    readonly owns?: boolean;
    readonly rules?: () => readonly ToolLoopRule[];
  } = {},
) {
  const ctx = new Context();
  onTestFinished(() => ctx.fiber.dispose());
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt, { includeRuntimeContext: false });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(NativeExecutor);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentLoop, { agents: [] });
  const adapter = new ScriptedAdapter(actions);
  ctx.llm.registerAdapter(["demo"], adapter);
  onTestFinished(
    installQaToolLoop(ctx, () => options.owns ?? true, {
      rules: options.rules,
      budget: {
        attempts: options.attempts ?? 16,
        outputTokens: options.outputTokens ?? 16_000,
        attemptMs: options.attemptMs ?? 4_000,
        closingMs: 1_000,
      },
    }),
  );
  let catalogExecutions = 0;
  let lookupExecutions = 0;
  const ran: string[] = [];
  const agent = await ctx.agentLoop.create(SessionId("demo-session"), {
    provider: "demo",
    model: "demo",
  });
  const register = (name: string, execute: () => string | Promise<string>) =>
    agent.ctx.tools.register(
      defineTool({
        name,
        description: "Return a synthetic result.",
        parameters: name === lookup ? { query: { type: "string" } } : {},
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: value }],
        },
        execute: async () => {
          ran.push(name);
          return execute();
        },
      }),
    );
  register(
    catalog,
    () => options.catalogResults?.[catalogExecutions++] ?? "demo-model",
  );
  register(lookup, async () => {
    if (options.lookupMs !== undefined) await wait(options.lookupMs);
    return options.lookupResults?.[lookupExecutions++] ?? "demo evidence";
  });
  register("qa_subagent", () => {
    throw new QaModelSelectionError("The selected model is disallowed.");
  });
  return { ctx, agent, adapter, ran };
}

async function send(
  ctx: Context,
  agent: Agent,
): Promise<TurnEndReason | undefined> {
  let reason: TurnEndReason | undefined;
  const disposeReason = ctx.on("session/event", (session, event) => {
    if (session === agent.session && event.type === "turn/end")
      reason = event.data.reason;
  });
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on("agent/status", ({ agent: current, status }) => {
      if (current === agent && status === "idle") {
        dispose();
        resolve();
      }
    });
  });
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text: "Find the relevant evidence." }],
      source: { kind: "user" },
    }),
  );
  try {
    await idle;
    return reason;
  } finally {
    disposeReason();
  }
}

it("blocks repeated catalog calls, offers only one closing attempt and resets on a new turn", async () => {
  const { ctx, agent, adapter, ran } = await harness([
    [catalog],
    [catalog],
    [catalog],
    [catalog],
    [lookup],
    [catalog],
    "answer",
  ]);
  const reason = await send(ctx, agent);
  expect(adapter.requests).toHaveLength(5);
  expect(ran).toEqual([catalog, catalog]);
  expect(reason).toEqual({
    kind: "aborted",
    reason: { kind: "hook", reason: QA_TOOL_LOOP_STOP },
  });
  const textOf = (req: GenerateOptions) => JSON.stringify(req.messages);
  expect(textOf(adapter.requests[2]!)).toContain(
    "has returned the same result twice",
  );
  expect(textOf(adapter.requests[4]!)).toContain("Finish this turn now");

  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(ran).toEqual([catalog, catalog, catalog]);
});

it("keeps a different tool available after blocking the repeated catalog call", async () => {
  const { ctx, agent, adapter, ran } = await harness([
    [catalog, catalog],
    [catalog],
    [catalog],
    [lookup],
    "answer",
  ]);
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(ran).toEqual([catalog, catalog, lookup]);
  expect(adapter.requests).toHaveLength(5);
});

it("keeps checking when the catalog changes and allows a refresh after a model refusal", async () => {
  const { ctx, agent, ran } = await harness(
    [
      [catalog],
      [catalog],
      [catalog],
      [catalog],
      [catalog],
      ["qa_subagent"],
      [catalog],
      "answer",
    ],
    { catalogResults: ["a", "b", "c", "c", "d"] },
  );
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(ran).toEqual([
    catalog,
    catalog,
    catalog,
    catalog,
    "qa_subagent",
    catalog,
  ]);
});

it("applies configured warnings, blocks and a finish to repeated results across changing arguments", async () => {
  let rules = resolveToolLoopRules([
    {
      tool: lookup,
      thresholds: [
        { calls: 2, action: "warn", message: "Use the first lookup result." },
        {
          calls: 3,
          action: "block",
          message: "This lookup is blocked for this turn.",
        },
        {
          calls: 4,
          action: "finish",
          message: "Stop looking up the same evidence.",
        },
      ],
    },
  ]);
  const { ctx, agent, adapter, ran } = await harness(
    [
      [{ tool: lookup, query: "first" }],
      [catalog],
      [{ tool: lookup, query: "different" }],
      [lookup, lookup],
      [lookup],
      [catalog],
      [lookup],
      [lookup],
      [lookup],
      "answer",
    ],
    { rules: () => rules },
  );
  expect(await send(ctx, agent)).toEqual({
    kind: "aborted",
    reason: { kind: "hook", reason: QA_TOOL_LOOP_STOP },
  });
  expect(ran).toEqual([lookup, catalog, lookup]);
  expect(JSON.stringify(adapter.requests[3]?.messages)).toContain(
    "Use the first lookup result.",
  );
  expect(JSON.stringify(adapter.requests[4]?.messages)).toContain(
    "This lookup is blocked for this turn.",
  );
  expect(JSON.stringify(adapter.requests[5]?.messages)).toContain(
    "Stop looking up the same evidence.",
  );
  expect(JSON.stringify(adapter.requests[5]?.messages)).toContain(
    "Finish this turn now",
  );

  rules = [];
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(ran).toEqual([lookup, catalog, lookup, lookup, lookup, lookup]);
});

it("warns at the configured character difference and resets when output moves away from the first result", async () => {
  const reminder = "Use the similar status already received.";
  const { ctx, agent, adapter } = await harness(
    [[lookup], [lookup], [lookup], [lookup], "answer"],
    {
      lookupResults: [
        "status=aaaa",
        "status=baaa",
        "status=bbaa",
        "status=bbaa",
      ],
      rules: () =>
        resolveToolLoopRules([
          {
            tool: lookup,
            maxDifferencePercent: 10,
            thresholds: [{ calls: 2, action: "warn", message: reminder }],
          },
        ]),
    },
  );
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(JSON.stringify(adapter.requests[2]?.messages.at(-1))).toContain(
    reminder,
  );
  expect(JSON.stringify(adapter.requests[3]?.messages.at(-1))).not.toContain(
    reminder,
  );
  expect(JSON.stringify(adapter.requests[4]?.messages.at(-1))).toContain(
    reminder,
  );
});

it.each([
  ["attempts", { attempts: 2 }],
  ["output tokens", { outputTokens: 10 }],
] as const)(
  "reserves one closing request when different calls exhaust the budget for %s",
  async (_limit, budget) => {
    const { ctx, agent, adapter, ran } = await harness(
      [[lookup], [catalog], [lookup]],
      budget,
    );
    const reason = await send(ctx, agent);
    expect(adapter.requests).toHaveLength(3);
    expect(ran).toEqual([lookup, catalog]);
    expect(reason).toEqual({
      kind: "aborted",
      reason: { kind: "hook", reason: QA_MODEL_BUDGET_STOP },
    });
  },
);

it("records a guarded stop if the closing request returns without an answer", async () => {
  const { ctx, agent, adapter } = await harness([
    [catalog],
    [catalog],
    [catalog],
    [catalog],
    "empty",
  ]);
  expect(await send(ctx, agent)).toEqual({
    kind: "aborted",
    reason: { kind: "hook", reason: QA_TOOL_LOOP_STOP },
  });
  expect(adapter.requests).toHaveLength(5);
});

it("cancels a single stalled model request through Harness", async () => {
  const { ctx, agent, adapter, ran } = await harness(["wait"], {
    attemptMs: 40,
  });
  const reason = await send(ctx, agent);
  expect(adapter.requests).toHaveLength(1);
  expect(adapter.requests[0]?.signal?.aborted).toBe(true);
  expect(ran).toEqual([]);
  expect(reason).toEqual({
    kind: "aborted",
    reason: { kind: "hook", reason: QA_MODEL_TIMEOUT_STOP },
  });
});

it("clears the generation timeout before running a slow tool", async () => {
  const { ctx, agent, adapter } = await harness([[lookup], "answer"], {
    attemptMs: 75,
    lookupMs: 150,
  });
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(adapter.requests).toHaveLength(2);
});

it("leaves calls by an unrelated Harness agent outside the QA policy", async () => {
  const { ctx, agent, ran } = await harness(
    [[catalog], [catalog], [catalog], [catalog], "answer"],
    { owns: false },
  );
  expect(await send(ctx, agent)).toEqual({ kind: "completed" });
  expect(ran).toEqual([catalog, catalog, catalog, catalog]);
});
