import { Context } from "@deepseek-ai/cordis";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expertExecutionBudget,
  type ExpertExecutionBudget,
} from "../src/host/execution-budget.js";

afterEach(() => vi.useRealTimers());

function harness(overrides: Partial<ExpertExecutionBudget> = {}) {
  const ctx = new Context();
  const controller = new AbortController();
  let complete: (result: unknown) => void = () => undefined;
  const dispose = vi.fn(async () => undefined);
  const original = {
    childId: "review-child",
    result: new Promise((resolve) => {
      complete = resolve;
    }),
    dispose,
  } as unknown as SubagentActivation;
  const budget = expertExecutionBudget(ctx, original.childId, {
    maxToolCalls: 4,
    maxConsecutiveRefusals: 2,
    timeoutMs: 1000,
    signal: controller.signal,
    ...overrides,
  });
  const activation = budget.bind(original);
  const result = activation.result.catch((error: Error) => error);
  const toolResult = (
    isError: boolean,
    id: string = original.childId,
    name = "read",
  ) =>
    ctx.emit(
      "tools/result",
      { agent: { id }, name } as never,
      { isError } as never,
    );
  return { ctx, activation, result, toolResult, dispose, complete, controller };
}

describe("expert execution budget", () => {
  it("shares its budget with delegated descendants, while human forks remain separate", async () => {
    const h = harness({ maxToolCalls: 2 });
    for (const [id, parentSession, isSeeded] of [
      ["research-child", "review-child", false],
      ["deep-child", "research-child", false],
      ["human-fork", "review-child", true],
    ] as const) {
      await h.ctx.serial("agent/created", {
        agent: {
          id,
          session: { header: { parentSession, isSeeded } },
        } as never,
        source: "create" as never,
      });
    }
    h.toolResult(false, "human-fork");
    h.toolResult(false, "deep-child");
    expect(h.dispose).not.toHaveBeenCalled();
    h.toolResult(false, "research-child");
    expect(await h.result).toMatchObject({
      message: expect.stringContaining("max-tool-calls"),
    });
    expect(h.dispose).toHaveBeenCalledOnce();
  });
  it("counts only its own child's errors and resets the refusal streak on success", async () => {
    const h = harness({ maxToolCalls: 0 });
    h.toolResult(true, "sibling");
    h.toolResult(true);
    h.toolResult(false);
    h.toolResult(true);
    expect(h.dispose).not.toHaveBeenCalled();
    h.toolResult(true);
    expect(await h.result).toMatchObject({
      message: expect.stringContaining("max-consecutive-refusals"),
    });
    expect(h.dispose).toHaveBeenCalledOnce();
    await h.activation.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("stops a successful but endless tool loop at its call budget", async () => {
    const h = harness({ maxToolCalls: 2 });
    h.toolResult(false);
    h.toolResult(false);
    expect(await h.result).toMatchObject({
      message: expect.stringContaining("max-tool-calls"),
    });
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("cancels a silent model on timeout and cleans up the monitor", async () => {
    vi.useFakeTimers();
    const h = harness({ timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(30);
    expect(await h.result).toMatchObject({
      message: expect.stringContaining("review-timeout"),
    });
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    h.toolResult(true);
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("releases a reviewer when its caller is cancelled", async () => {
    const h = harness();
    h.controller.abort();
    expect(await h.result).toMatchObject({
      message: expect.stringContaining("review-aborted"),
    });
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it("allows structured completion and removes the timeout after a normal result", async () => {
    vi.useFakeTimers();
    const h = harness({ maxToolCalls: 1 });
    h.toolResult(false, "review-child", "structured_output");
    h.complete({ stopReason: "completed" });
    expect(await h.result).toEqual({ stopReason: "completed" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.dispose).not.toHaveBeenCalled();
    await h.activation.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
  });
});
