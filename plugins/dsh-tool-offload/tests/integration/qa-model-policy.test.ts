/**
 * The worker child's model under a QA policy: a profile that names no model
 * follows the policy of the chat the tool result came from, rather than the
 * model that chat happens to be sitting on.
 */

import { describe, expect, it } from "vitest";
import type {
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from "@deepseek-ai/dsh-subagent";
import {
  createSubagentRunner,
  type SubagentsServiceLike,
  type WorkerRunRequest,
} from "../../src/worker/runner.js";
import { resolveToolOffloadConfig } from "../../src/config.js";
import { fakeAgent } from "../fixtures/offload-fixtures.js";

/** A worker profile that names no model, so it inherits by default. */
const OPEN_PROFILE = resolveToolOffloadConfig({
  workers: { default: { maxTokens: 2_500, timeoutMs: 5_000 } },
}).workers.default!;

const PINNED_PROFILE = resolveToolOffloadConfig({
  workers: {
    default: { provider: "zai", model: "glm-4.5-air", timeoutMs: 5_000 },
  },
}).workers.default!;

function service(): {
  subagents: SubagentsServiceLike;
  starts: SubagentStartRequest[];
} {
  const starts: SubagentStartRequest[] = [];
  const subagents: SubagentsServiceLike = {
    start: async (_name, request) => {
      starts.push(request);
      return {
        id: "child-1",
        result: Promise.resolve({
          output: [{ type: "text", text: "compact answer" }],
          stopReason: "completed",
        } satisfies SubagentResult),
        dispose: async () => undefined,
      } as unknown as SubagentRun;
    },
    getProvider: () => ({
      name: "spawn",
      capabilities: { toolFilter: true, agentOptions: true },
    }),
  };
  return { subagents, starts };
}

function request(overrides: Partial<WorkerRunRequest> = {}): WorkerRunRequest {
  return {
    label: "dsh-tool-offload:read",
    parent: fakeAgent({ id: "session-parent" }),
    prompt: "PROMPT",
    signal: new AbortController().signal,
    profile: OPEN_PROFILE,
    ...overrides,
  };
}

describe("the worker model under a QA policy", () => {
  it("takes the pair the policy of the chat names", async () => {
    const { subagents, starts } = service();
    const asked: string[] = [];
    const runner = createSubagentRunner(subagents, (sessionId) => {
      asked.push(sessionId);
      return { provider: "local", model: "small" };
    });
    await runner.run(request());
    expect(asked).toEqual(["session-parent"]);
    expect(starts[0]?.agentOptions).toEqual({
      provider: "local",
      model: "small",
      maxTokens: 2_500,
    });
  });

  it("keeps a model the profile pinned itself", async () => {
    const { subagents, starts } = service();
    const asked: string[] = [];
    const runner = createSubagentRunner(subagents, (sessionId) => {
      asked.push(sessionId);
      return { provider: "local", model: "small" };
    });
    await runner.run(request({ profile: PINNED_PROFILE }));
    expect(asked).toEqual([]);
    expect(starts[0]?.agentOptions).toEqual({
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 4_000,
    });
  });

  it("inherits the parent where the deployment says nothing about models", async () => {
    const { subagents, starts } = service();
    const runner = createSubagentRunner(subagents, () => undefined);
    await runner.run(request());
    expect(starts[0]?.agentOptions).toEqual({ maxTokens: 2_500 });
  });

  it("runs unchanged with no policy source at all", async () => {
    const { subagents, starts } = service();
    const runner = createSubagentRunner(subagents);
    await runner.run(request({ profile: PINNED_PROFILE }));
    expect(starts[0]?.agentOptions).toEqual({
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 4_000,
    });
  });
});
