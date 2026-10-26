/**
 * Integration tests for the subagent-backed WorkerRunner against a fake
 * `ctx.subagents` service (SPEC §9.5, §22-§25: preset-gated no-tools worker,
 * exact model config, timeout, cancellation, disposal).
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

interface ProviderStub {
  readonly name: string;
  readonly capabilities: SubagentCapabilities;
  readonly inheritsParentContext: boolean;
}

/** A worker profile that names the no-tools preset the deployment provides. */
function presetProfile(
  overrides: Partial<WorkerRunRequest["profile"]> = {},
): WorkerRunRequest["profile"] {
  return {
    ...resolveToolOffloadConfig({
      workers: {
        default: {
          agentPreset: "bare-worker",
          provider: "zai",
          model: "glm-4.5-air",
          maxTokens: 2_500,
          timeoutMs: 5_000,
        },
      },
    }).workers.default!,
    ...overrides,
  };
}

function baseRequest(
  overrides: Partial<WorkerRunRequest> = {},
): WorkerRunRequest {
  return {
    label: "dsh-tool-offload:read",
    parent: fakeAgent(),
    prompt: "PROMPT",
    signal: new AbortController().signal,
    profile: presetProfile(),
    ...overrides,
  };
}

function fakeActivation(result: Promise<SubagentResult>): {
  activation: SubagentActivation;
  disposed: () => boolean;
} {
  let disposed = false;
  const activation = {
    childId: "child-1",
    result,
    dispose: async () => {
      disposed = true;
    },
  } as unknown as SubagentActivation;
  return { activation, disposed: () => disposed };
}

const FULL_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  agentPreset: true,
  outputSchema: true,
  depthLimit: true,
};

function service(
  overrides: {
    provider?: ProviderStub;
    startActivation?: (
      spec: SubagentActivationSpec,
    ) => Promise<SubagentActivation>;
  } = {},
): {
  subagents: SubagentsServiceLike;
  specs: SubagentActivationSpec[];
} {
  const specs: SubagentActivationSpec[] = [];
  const subagents: SubagentsServiceLike = {
    startActivation: async (spec) => {
      specs.push(spec);
      if (overrides.startActivation) {
        return overrides.startActivation(spec);
      }
      const { activation } = fakeActivation(
        Promise.resolve({
          output: [{ type: "text", text: "  compact answer  " }],
          stopReason: "completed",
        }),
      );
      return activation;
    },
    getProvider: () =>
      "provider" in overrides
        ? overrides.provider
        : {
            name: "spawn",
            capabilities: FULL_CAPABILITIES,
            // A spawned child starts fresh: it never sees the conversation.
            inheritsParentContext: false,
          },
  };
  return { subagents, specs };
}

describe("createSubagentRunner availability (SPEC §36.7, §40.2)", () => {
  it("reports unavailable when the provider is not registered", async () => {
    const { subagents } = service({ provider: undefined });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toMatchObject({ kind: "unavailable" });
  });

  it("reports unavailable when the provider cannot select an independent preset", async () => {
    const { subagents } = service({
      provider: {
        name: "acp",
        capabilities: { ...FULL_CAPABILITIES, agentPreset: false },
        inheritsParentContext: false,
      },
    });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toEqual({
      kind: "unavailable",
      detail:
        'subagent provider "spawn" does not support independent agent presets',
    });
  });

  it("never starts a worker without a no-tools preset (SPEC §6.1)", async () => {
    const started = service();
    const runner = createSubagentRunner(started.subagents);
    const outcome = await runner.run(
      baseRequest({ profile: presetProfile({ agentPreset: null }) }),
    );
    expect(outcome).toMatchObject({ kind: "unavailable" });
    expect(
      outcome.kind === "unavailable" &&
        /would inherit the parent's tool composition/.test(outcome.detail),
    ).toBe(true);
    expect(started.specs).toHaveLength(0);
  });

  it("reports aborted without starting when the parent signal already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = service();
    const runner = createSubagentRunner(started.subagents);
    const outcome = await runner.run(
      baseRequest({ signal: controller.signal }),
    );
    expect(outcome).toEqual({ kind: "aborted" });
    expect(started.specs).toHaveLength(0);
  });
});

describe("createSubagentRunner start contract (SPEC §6.1, §9.5)", () => {
  it("starts a preset-scoped one-shot worker with the exact model override", async () => {
    const { subagents, specs } = service();
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(baseRequest());
    expect(outcome).toEqual({
      kind: "completed",
      outputText: "compact answer",
      stopReason: "completed",
    });
    const spec = specs[0];
    expect(spec?.provider).toBe("spawn");
    expect(spec?.label).toBe("dsh-tool-offload:read");
    expect(spec?.delivery).toBe("caller");
    expect(spec?.request.agentPreset).toBe("bare-worker");
    expect(spec?.request.agentOptions).toEqual({
      provider: "zai",
      model: "glm-4.5-air",
      maxTokens: 2_500,
    });
    expect(spec?.request.prompt).toEqual([{ type: "text", text: "PROMPT" }]);
    expect(spec?.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits agentOptions keys that would break route inheritance", async () => {
    const { subagents, specs } = service();
    const runner = createSubagentRunner(subagents);
    const inherited = resolveToolOffloadConfig({
      workers: { default: { agentPreset: "bare-worker" } },
    }).workers.default!;
    await runner.run(baseRequest({ profile: inherited }));
    expect(specs[0]?.request.agentOptions).toEqual({ maxTokens: 4_000 });
  });
});

describe("createSubagentRunner outcomes (SPEC §22)", () => {
  it("maps a worker error stop reason to failed with the diagnostic", async () => {
    const { subagents } = service({
      startActivation: async () => {
        const { activation } = fakeActivation(
          Promise.resolve({
            output: [],
            stopReason: "error",
            diagnostic: "model unreachable",
          }),
        );
        return activation;
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({
      kind: "failed",
      detail: 'worker stopped with reason "error": model unreachable',
    });
  });

  it("maps an abort that the parent did not request to timeout", async () => {
    const { subagents } = service({
      startActivation: async () => {
        const { activation } = fakeActivation(
          Promise.resolve({ output: [], stopReason: "aborted" }),
        );
        return activation;
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({ kind: "timeout" });
  });

  it("disposes the activation after completion", async () => {
    let disposed = false;
    const { subagents } = service({
      startActivation: async () => {
        const activation = {
          childId: "child-1",
          result: Promise.resolve({
            output: [{ type: "text", text: "done" }],
            stopReason: "completed",
          }),
          dispose: async () => {
            disposed = true;
          },
        } as unknown as SubagentActivation;
        return activation;
      },
    });
    await createSubagentRunner(subagents).run(baseRequest());
    expect(disposed).toBe(true);
  });

  it("times out and disposes an activation that never settles (SPEC §23)", async () => {
    let disposed = false;
    const { subagents } = service({
      startActivation: async () => {
        const activation = {
          childId: "child-1",
          result: new Promise<SubagentResult>(() => undefined),
          dispose: async () => {
            disposed = true;
          },
        } as unknown as SubagentActivation;
        return activation;
      },
    });
    const runner = createSubagentRunner(subagents);
    const outcome = await runner.run(
      baseRequest({
        profile: presetProfile({ timeoutMs: 30 }),
      }),
    );
    expect(outcome).toEqual({ kind: "timeout" });
    expect(disposed).toBe(true);
  }, 5_000);

  it("maps startup rejection to failed with the message", async () => {
    const { subagents } = service({
      startActivation: async () => {
        throw new Error("capability rejected");
      },
    });
    const outcome = await createSubagentRunner(subagents).run(baseRequest());
    expect(outcome).toEqual({ kind: "failed", detail: "capability rejected" });
  });
});
