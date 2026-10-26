/**
 * The worker child's model under a QA policy: a profile that names no model
 * follows the policy of the chat the tool result came from, rather than the
 * model that chat happens to be sitting on.
 */

import { describe, expect, it } from "vitest";
import type {
  SubagentActivation,
  SubagentActivationSpec,
  SubagentCapabilities,
  SubagentResult,
} from "@deepseek-ai/dsh-subagent";

import {
  createSubagentRunner,
  type SubagentsServiceLike,
  type WorkerRunRequest,
} from "../../src/worker/runner.js";
import { resolveToolOffloadConfig } from "../../src/config.js";
import { fakeAgent } from "../fixtures/offload-fixtures.js";

const FULL_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  agentPreset: true,
  outputSchema: true,
  depthLimit: true,
};

/** A worker profile that names no model, so it inherits by default. */
const OPEN_PROFILE = resolveToolOffloadConfig({
  workers: {
    default: { agentPreset: "bare-worker", maxTokens: 2_500, timeoutMs: 5_000 },
  },
}).workers.default!;

const PINNED_PROFILE = resolveToolOffloadConfig({
  workers: {
    default: {
      agentPreset: "bare-worker",
      provider: "zai",
      model: "glm-4.5-air",
      timeoutMs: 5_000,
    },
  },
}).workers.default!;

function service(): {
  subagents: SubagentsServiceLike;
  specs: SubagentActivationSpec[];
} {
  const specs: SubagentActivationSpec[] = [];
  const subagents: SubagentsServiceLike = {
    startActivation: async (spec) => {
      specs.push(spec);
      return {
        childId: "child-1",
        result: Promise.resolve({
          output: [{ type: "text", text: "compact answer" }],
          stopReason: "completed",
        } satisfies SubagentResult),
        dispose: async () => undefined,
      } as unknown as SubagentActivation;
    },
    getProvider: () => ({
      name: "spawn",
      capabilities: FULL_CAPABILITIES,
      inheritsParentContext: false,
    }),
  };
  return { subagents, specs };
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
    const { subagents, specs } = service();
    const asked: string[] = [];
    const runner = createSubagentRunner(subagents, (sessionId) => {
      asked.push(sessionId);
      return { provider: "local", model: "small" };
    });
    await runner.run(request());
    expect(asked).toEqual(["session-parent"]);
    expect(specs[0]?.request.agentOptions).toEqual({
      provider: "local",
      model: "small",
      maxTokens: 2_500,
    });
  });

  it("keeps a model the profile pinned itself", async () => {
    const { subagents, specs } = service();
    const asked: string[] = [];
    const runner = createSubagentRunner(subagents, (sessionId) => {
      asked.push(sessionId);
      return { provider: "local", model: "small" };
    });
    await runner.run(request({ profile: PINNED_PROFILE }));
    expect(asked).toEqual([]);
    expect(specs[0]?.request.agentOptions).toEqual({
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 4_000,
    });
  });

  it("inherits the parent where the deployment says nothing about models", async () => {
    const { subagents, specs } = service();
    const runner = createSubagentRunner(subagents, () => undefined);
    await runner.run(request());
    expect(specs[0]?.request.agentOptions).toEqual({ maxTokens: 2_500 });
  });

  it("runs unchanged with no policy source at all", async () => {
    const { subagents, specs } = service();
    const runner = createSubagentRunner(subagents);
    await runner.run(request({ profile: PINNED_PROFILE }));
    expect(specs[0]?.request.agentOptions).toEqual({
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 4_000,
    });
  });
});
