import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolveChildDepth } from "@deepseek-ai/dsh-subagent";
import { agentOf } from "./helpers/fakes.js";
import { createDomainExpertTool } from "../src/host/tools/domain-expert.js";
import { call, harnessOf } from "./tools.helpers.js";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { createScope, type Scope } from "@deepseek-ai/dsh-scope";
import ToolsService from "@deepseek-ai/dsh-tools";
import {
  executeToolBatch,
  ToolExecutionPipeline,
} from "@deepseek-ai/dsh-tools/pipeline";
import {
  installForegroundReview,
  type ForegroundReviewContext,
} from "@yadsh/dsh-plugin-kit/review-foreground";
import { describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Terminal = {
  stopReason: string;
  output: { type: "text"; text: string }[];
  diagnostic?: string;
};

async function harness(
  options: { external?: boolean; cancelOnDispose?: boolean } = {},
) {
  const ctx = new Context();
  ctx.provide("systemPrompt", {
    tools: () => () => {},
    context: (section: { order: number }) => {
      expect(Number.isFinite(section.order)).toBe(true);
      return () => {};
    },
  });
  new ToolsService(ctx);
  const terminal = deferred<Terminal>();
  const dispose = vi.fn(async () => {
    if (options.cancelOnDispose)
      terminal.resolve({ stopReason: "aborted", output: [] });
  });
  const start = vi.fn(
    async (_spec: {
      parent: object;
      delivery: string;
      signal: AbortSignal;
      name?: string;
      childId?: string;
      maxDepth?: number;
    }) => ({
      childId: "worker-child",
      name: "worker",
      result: terminal.promise,
      dispose,
    }),
  );
  const runtime = {
    startActivation: start,
    getProvider: () => (options.external ? {} : { prepareContinuable() {} }),
  };
  ctx.provide("subagents", runtime);
  const reviewer = agentOf({ id: "review-child", depth: 1 });
  Object.assign(reviewer, { options: {} });
  const primary = agentOf({ id: "primary", depth: 0 });
  let scope!: Scope;
  await ctx.plugin(
    Object.assign(
      (inner: Context) => {
        scope = createScope(inner, reviewer);
      },
      { inject: ["tools", "subagents"] },
    ),
  );
  installForegroundReview(
    scope.ctx as unknown as ForegroundReviewContext,
    reviewer,
  );
  ctx.tools.register({
    name: "verify_source",
    description: "Delegate source verification",
    parameters: { type: "object", properties: {} },
    output: {
      schema: {
        type: "object",
        properties: {
          kind: { type: "string", const: "activation" },
          name: { type: "string" },
        },
      },
      render: () => [{ type: "text", text: "started worker" }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const activation = await runtime.startActivation({
        parent: exec.agent!,
        provider: "spawn",
        signal: exec.signal,
        delivery: "parent",
        name: "worker",
      } as Parameters<typeof start>[0]);
      return { kind: "activation", name: activation.name };
    },
  });
  const capture = vi.fn(async () => "captured");
  ctx.tools.register({
    name: "structured_output",
    description: "Finish review",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "string" },
      render: () => [{ type: "text", text: "captured" }],
    },
    execute: capture,
  });
  const run = (
    agent = reviewer,
    signal = new AbortController().signal,
    names = ["verify_source"],
    parallel = 1,
  ) =>
    executeToolBatch(
      {
        calls: names.map((name, i) => ({
          type: "tool-call" as const,
          id: ToolCallId(`call-${i}`),
          name,
          arguments: "{}",
        })),
        signal,
        agent,
      },
      new ToolExecutionPipeline(ctx),
      () => parallel,
    );
  return {
    ctx,
    scope,
    runtime,
    start,
    terminal,
    dispose,
    capture,
    run,
    reviewer,
    primary,
  };
}

describe("foreground reviewer delegation through the real Host pipeline", () => {
  it("joins every parallel worker before the review can capture its verdict", async () => {
    const h = await harness();
    const workers = [deferred<Terminal>(), deferred<Terminal>()];
    const disposals = [vi.fn(), vi.fn()];
    let nextWorker = 0;
    h.start.mockImplementation(async () => {
      const index = nextWorker++;
      return {
        childId: `parallel-${index}`,
        name: `worker-${index}`,
        result: workers[index]!.promise,
        dispose: disposals[index]!,
      };
    });
    try {
      const pending = h.run(
        h.reviewer,
        undefined,
        ["verify_source", "verify_source", "structured_output"],
        2,
      );
      await vi.waitFor(() => expect(h.start).toHaveBeenCalledTimes(2));
      workers[0]!.resolve({
        stopReason: "completed",
        output: [{ type: "text", text: "First evidence." }],
      });
      await vi.waitFor(() => expect(disposals[0]).toHaveBeenCalledOnce());
      expect(h.capture).not.toHaveBeenCalled();
      expect(disposals[1]).not.toHaveBeenCalled();
      workers[1]!.resolve({
        stopReason: "completed",
        output: [{ type: "text", text: "Second evidence." }],
      });
      const batch = await pending;
      expect(batch.results.every(({ result }) => !result.isError)).toBe(true);
      expect(batch.results[0]!.result.content).toContainEqual({
        type: "text",
        text: "First evidence.",
      });
      expect(batch.results[1]!.result.content).toContainEqual({
        type: "text",
        text: "Second evidence.",
      });
      expect(h.capture).toHaveBeenCalledOnce();
      expect(disposals[1]).toHaveBeenCalledOnce();
    } finally {
      await h.scope.dispose();
    }
  });

  it("executes an aliased worker and waits for its answer before structured output", async () => {
    const h = await harness();
    try {
      const pending = h.run(h.reviewer, undefined, [
        "verify_source",
        "structured_output",
      ]);
      await vi.waitFor(() => expect(h.start).toHaveBeenCalledOnce());
      expect(h.start.mock.calls[0]![0].delivery).toBe("caller");
      expect(h.capture).not.toHaveBeenCalled();
      expect(h.dispose).not.toHaveBeenCalled();
      h.terminal.resolve({
        stopReason: "completed",
        output: [{ type: "text", text: "Verified: 17 * 23 = 391." }],
      });
      const result = await pending;
      expect(result.results[0]!.result.isError).toBe(false);
      expect(result.results[0]!.result.content).toContainEqual({
        type: "text",
        text: "Verified: 17 * 23 = 391.",
      });
      expect(h.capture).toHaveBeenCalledOnce();
      expect(h.dispose).toHaveBeenCalledOnce();
    } finally {
      await h.scope.dispose();
    }
  });

  it("leaves a concurrent ordinary agent's background delivery unchanged and restores the runtime", async () => {
    const h = await harness();
    const pending = h.run();
    await vi.waitFor(() => expect(h.start).toHaveBeenCalledOnce());
    const ordinary = await h.run(h.primary);
    expect(ordinary.results[0]!.result.isError).toBe(false);
    expect(h.start.mock.calls[1]![0].delivery).toBe("parent");
    h.terminal.resolve({ stopReason: "completed", output: [] });
    await pending;
    await h.scope.dispose();
    expect(h.runtime.startActivation).toBe(h.start);
  });

  it("propagates child failure and disposes it instead of returning a successful activation", async () => {
    const h = await harness();
    try {
      const pending = h.run();
      await vi.waitFor(() => expect(h.start).toHaveBeenCalledOnce());
      h.terminal.resolve({
        stopReason: "error",
        output: [],
        diagnostic: "provider unavailable",
      });
      const result = (await pending).results[0]!.result;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("provider unavailable");
      expect(h.dispose).toHaveBeenCalledOnce();
    } finally {
      await h.scope.dispose();
    }
  });

  it("cancels and joins a child before returning the aborted tool result", async () => {
    const h = await harness({ cancelOnDispose: true });
    try {
      const controller = new AbortController();
      const pending = h.run(h.reviewer, controller.signal);
      await vi.waitFor(() => expect(h.start).toHaveBeenCalledOnce());
      controller.abort();
      expect((await pending).results[0]!.result.isError).toBe(true);
      expect(h.dispose).toHaveBeenCalledOnce();
    } finally {
      await h.scope.dispose();
    }
  });

  it("awaits an external worker without requesting an unsupported catalog name", async () => {
    const h = await harness({ external: true });
    try {
      const pending = h.run();
      await vi.waitFor(() => expect(h.start).toHaveBeenCalledOnce());
      expect(h.start.mock.calls[0]![0]).not.toHaveProperty("name");
      h.terminal.resolve({ stopReason: "completed", output: [] });
      expect((await pending).results[0]!.result.isError).toBe(false);
    } finally {
      await h.scope.dispose();
    }
  });

  it("forces domain_expert background requests to foreground for the reviewer", async () => {
    const h = await harness();
    try {
      const domain = harnessOf();
      await call(
        createDomainExpertTool(domain.dependencies),
        { domain: "payments", task: "Verify evidence", background: true },
        h.reviewer,
      );
      expect(domain.runs[0]?.background).toBe(false);
      await call(
        createDomainExpertTool(domain.dependencies),
        { domain: "payments", task: "Verify evidence", background: true },
        h.primary,
      );
      expect(domain.runs[1]?.background).toBe(true);
    } finally {
      await h.scope.dispose();
    }
  });

  it("inherits foreground waiting through depth 3 and enforces the Host cap at depth 4", async () => {
    const h = await harness();
    const attempts: number[] = [];
    const childScopes: Scope[] = [];
    let fourthRefused = false;
    h.start.mockImplementation(async (spec) => {
      const requested =
        (spec.parent as Agent).session.header.delegationDepth! + 1;
      attempts.push(requested);
      const depth = resolveChildDepth(spec.parent as Agent, 3);
      const child = agentOf({ id: spec.childId!, depth });
      Object.assign(child, { options: {} });
      let scope!: Scope;
      await h.ctx.plugin(
        Object.assign(
          (inner: Context) => {
            scope = createScope(inner, child);
          },
          { inject: ["tools", "subagents"] },
        ),
      );
      childScopes.push(scope);
      Object.assign(child, { ctx: scope.ctx });
      h.ctx.emit("agent/created", { agent: child, source: "create" } as never);
      const result = h.run(child).then(async (batch) => {
        if (depth === 3) fourthRefused = batch.results[0]!.result.isError;
        return h.terminal.promise;
      });
      return {
        childId: spec.childId!,
        name: `level-${depth}`,
        result,
        dispose: vi.fn(async () => {
          await scope.dispose();
        }),
      };
    });
    try {
      let settled = false;
      const pending = h.run().then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() => expect(attempts).toEqual([2, 3, 4]));
      expect(fourthRefused).toBe(true);
      expect(settled).toBe(false);
      expect(
        h.start.mock.calls.every(([spec]) => spec.delivery === "caller"),
      ).toBe(true);
      h.terminal.resolve({
        stopReason: "completed",
        output: [{ type: "text", text: "Nested evidence complete." }],
      });
      expect((await pending).results[0]!.result.isError).toBe(false);
    } finally {
      await Promise.all(childScopes.map((scope) => scope.dispose()));
      await h.scope.dispose();
    }
  });
});
