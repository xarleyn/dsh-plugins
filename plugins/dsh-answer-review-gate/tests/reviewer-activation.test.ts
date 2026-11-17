import { describe, expect, it, vi } from "vitest";
import { nonDelegatingReviewers } from "../src/reviewer-activation.js";
import type { GateHostContext } from "../src/index.js";
import type { SubagentActivationSpec, SubagentsFace } from "../src/types.js";

function harness(
  options: { skipLifecycle?: boolean; external?: boolean; fail?: boolean } = {},
) {
  let created: ((payload: unknown) => void) | undefined;
  let guard: ((execution: { name: string }) => string | undefined) | undefined;
  const unsubscribe = vi.fn(() => {
    created = undefined;
  });
  const dispose = vi.fn();
  const startNested = vi.fn();
  const ctx = {
    on: vi.fn((_event, handler) => {
      created = handler;
      return unsubscribe;
    }),
  } as unknown as GateHostContext;
  const face: SubagentsFace = {
    getProvider: () => ({
      name: "spawn",
      capabilities: {
        outputSchema: true,
        agentPreset: true,
        agentOptions: true,
        depthLimit: true,
      },
      inheritsParentContext: false,
      ...(options.external ? {} : { prepareContinuable: () => {} }),
    }),
    startActivation: vi.fn(async (spec) => {
      if (options.fail) throw new Error("provider refused");
      const agent = {
        id: spec.childId,
        ctx: {
          tools: {
            get: () => ({
              output: {
                schema: { properties: { kind: { const: "activation" } } },
              },
            }),
            guard: (value: typeof guard) => {
              guard = value;
              return () => {};
            },
          },
        },
      };
      // A concurrent ordinary child must not acquire the reviewer's policy.
      const unrelatedGuard = vi.fn();
      created?.({
        agent: { id: "sibling", ctx: { tools: { guard: unrelatedGuard } } },
      });
      expect(unrelatedGuard).not.toHaveBeenCalled();
      if (!options.skipLifecycle) created?.({ agent });
      // First model prompt: the guard must already reject this aliased worker.
      if (guard?.({ name: "verify_source" }) === undefined) startNested();
      return {
        childId: spec.childId!,
        result: Promise.resolve({
          stopReason: "completed",
          output: [],
          structured: {
            verdict: "pass",
            summary: "verified directly",
            issues: [],
          },
        }),
        dispose,
      };
    }),
  };
  const spec: SubagentActivationSpec = {
    provider: "spawn",
    label: "answer-review",
    prompt: [],
    parent: {},
    signal: new AbortController().signal,
    delivery: "caller",
  };
  return { ctx, face, spec, dispose, unsubscribe, startNested };
}

describe("reviewer policy before initial prompt", () => {
  it("blocks nested background work and still returns the reviewer's captured verdict", async () => {
    const h = harness();
    const activation = await nonDelegatingReviewers(
      h.ctx,
      h.face,
    ).startActivation(h.spec);
    expect(h.startNested).not.toHaveBeenCalled();
    expect((await activation.result).structured).toMatchObject({
      verdict: "pass",
    });
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    await activation.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("disposes a provider that skipped the policy boundary", async () => {
    const h = harness({ skipLifecycle: true });
    await expect(
      nonDelegatingReviewers(h.ctx, h.face).startActivation(h.spec),
    ).rejects.toMatchObject({ reason: "reviewer-capability-unsupported" });
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it("refuses an external backend before starting an unguarded reviewer", async () => {
    const h = harness({ external: true });
    await expect(
      nonDelegatingReviewers(h.ctx, h.face).startActivation(h.spec),
    ).rejects.toMatchObject({ reason: "reviewer-capability-unsupported" });
    expect(h.face.startActivation).not.toHaveBeenCalled();
  });

  it("removes the temporary listener if creation fails", async () => {
    const h = harness({ fail: true });
    await expect(
      nonDelegatingReviewers(h.ctx, h.face).startActivation(h.spec),
    ).rejects.toThrow("provider refused");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
