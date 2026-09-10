/**
 * Integration tests for the subagent-backed WorkerRunner against a fake
 * `ctx.subagents` service (SPEC §9.5, §22-§25: exact model config, no-tools
 * restriction, timeout, cancellation, disposal).
 */

import { describe, expect, it } from "vitest";

import type { SubagentResult, SubagentRun, SubagentStartRequest } from "@deepseek-ai/dsh-subagent";

import { createSubagentRunner, type SubagentsServiceLike, type WorkerRunRequest } from "../../src/worker/runner.js";
import { resolveToolOffloadConfig } from "../../src/config.js";
import { fakeAgent } from "../fixtures/offload-fixtures.js";

interface ProviderStub {
  readonly name: string;
  readonly capabilities: { readonly toolFilter: boolean };
}

function baseRequest(overrides: Partial<WorkerRunRequest> = {}): WorkerRunRequest {
  return {
    label: "dsh-tool-offload:read",
    parent: fakeAgent(),
    prompt: "PROMPT",
    signal: new AbortController().signal,
    profile: resolveToolOffloadConfig({
      workers: { default: { provider: "zai", model: "glm-4.5-air", maxTokens: 2_500, timeoutMs: 5_000 } },
    }).workers.default!,
    ...overrides,
  };
}

function fakeRun(result: SubagentRun["result"]): { run: SubagentRun; disposed: () => boolean } {
  let disposed = false;
  const run = {
    id: "child-1",
    localAgent: undefined,
    result,
    dispose: async () => {
      disposed = true;
    },
  } as unknown as SubagentRun;
  return { run, disposed: () => disposed };
}

function service(overrides: { provider?: ProviderStub; start?: (name: string, request: SubagentStartRequest) => Promise<SubagentRun> } = {}): {
  subagents: SubagentsServiceLike;
  starts: SubagentStartRequest[];
} {
  const starts: SubagentStartRequest[] = [];
  const subagents: SubagentsServiceLike = {
    start: async (name, request) => {
      starts.push(request);
      if (overrides.start) return overrides.start(name, request);
      const { run } = fakeRun(Promise.resolve({ output: [{ type: "text", text: "  compact answer  " }], stopReason: "completed" }));
      return run;
    },
    getProvider: () => ("provider" in overrides ? overrides.provider : { name: "spawn", capabilities: { toolFilter: true } }),
  };
  return { subagents, starts };
}

describe("createSubagentRunner availability (SPEC §36.7, §40.2)", () => {
  it("reports unavailable when the provider is not registered", async () => {
    const { subagents } = service({ provider: undefined });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toMatchObject({ kind: "unavailable" });
  });

  it("reports unavailable when the provider cannot restrict tools (SPEC §6.1)", async () => {
    const { subagents } = service({ provider: { name: "acp", capabilities: { toolFilter: false } } });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toEqual({
      kind: "unavailable",
      detail: 'subagent provider "spawn" does not support tool restrictions',
    });
  });

  it("reports aborted without starting when the parent signal already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = service();
    const runner = createSubagentRunner(started.subagents);
    const outcome = await runner.run(baseRequest({ signal: controller.signal }));
    expect(outcome).toEqual({ kind: "aborted" });
    expect(started.starts).toHaveLength(0);
  });
});

describe("createSubagentRunner start contract (SPEC §6.1, §9.5)", () => {
  it("starts a no-tools one-shot worker with the exact model override", async () => {
    const { subagents, starts } = service();
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toEqual({ kind: "completed", outputText: "compact answer", stopReason: "completed" });
    const request = starts[0];
    expect(request?.label).toBe("dsh-tool-offload:read");
    expect(request?.toolFilter).toEqual({ allow: [] });
    expect(request?.agentOptions).toEqual({ provider: "zai", model: "glm-4.5-air", maxTokens: 2_500 });
    expect(request?.prompt).toEqual([{ type: "text", text: "PROMPT" }]);
  });

  it("omits agentOptions keys that would break route inheritance", async () => {
    const { subagents, starts } = service();
    const runner = createSubagentRunner(subagents);
    const profile = resolveToolOffloadConfig({}).workers.default!;
    await runner.run(baseRequest({ profile }));
    expect(starts[0]?.agentOptions).toEqual({ maxTokens: 4_000 });
  });
});

describe("createSubagentRunner outcomes (SPEC §22)", () => {
  it("maps a worker error stop reason to failed with the diagnostic", async () => {
    const { subagents } = service({
      start: async () => {
        const { run } = fakeRun(Promise.resolve({ output: [], stopReason: "error", diagnostic: "model unreachable" }));
        return run;
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({ kind: "failed", detail: 'worker stopped with reason "error": model unreachable' });
  });

  it("maps an abort that the parent did not request to timeout", async () => {
    const { subagents } = service({
      start: async () => {
        const { run } = fakeRun(Promise.resolve({ output: [], stopReason: "aborted" }));
        return run;
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({ kind: "timeout" });
  });

  it("disposes the run after completion", async () => {
    let disposed = false;
    const { subagents } = service({
      start: async () => {
        const run = {
          id: "child-1",
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: "text", text: "done" }], stopReason: "completed" }),
          dispose: async () => {
            disposed = true;
          },
        } as unknown as SubagentRun;
        return run;
      },
    });
    await createSubagentRunner(subagents).run(baseRequest());
    expect(disposed).toBe(true);
  });

  it("times out and disposes a run that never settles (SPEC §23)", async () => {
    let disposed = false;
    const { subagents } = service({
      start: async () => {
        const run = {
          id: "child-1",
          localAgent: undefined,
          result: new Promise<SubagentResult>(() => undefined),
          dispose: async () => {
            disposed = true;
          },
        } as unknown as SubagentRun;
        return run;
      },
    });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest({ profile: { ...baseRequest().profile, timeoutMs: 30 } }));
    expect(outcome).toEqual({ kind: "timeout" });
    expect(disposed).toBe(true);
  }, 5_000);

  it("maps startup rejection to failed with the message", async () => {
    const { subagents } = service({
      start: async () => {
        throw new Error("capability rejected");
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({ kind: "failed", detail: "capability rejected" });
  });
});
