/**
 * Integration tests for the tools/post-execute interception seam with a
 * scripted fake worker runner (SPEC §32.2: full sequence — tool executes,
 * post-execute fires, candidate qualifies, worker runs, parent-facing
 * content is replaced, canonical value is preserved).
 */

import { describe, expect, it } from "vitest";

import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

import { createPostExecuteListener, OFFLOAD_ANNOTATION_MARKER } from "../../src/integration/post-execute.js";
import { OffloadCounters } from "../../src/telemetry/counters.js";
import { KeyedLimiter, Semaphore } from "../../src/utils/semaphore.js";
import { byteLength } from "../../src/utils/text.js";
import {
  CapturingLogger,
  FakeRunner,
  errorResult,
  fakeAgent,
  fakeExec,
  makeText,
  successResult,
  testConfig,
} from "../fixtures/offload-fixtures.js";

const accept: PostToolDecision = { kind: "accept" };

interface Harness {
  listener: ReturnType<typeof createPostExecuteListener>;
  runner: FakeRunner;
  counters: OffloadCounters;
  logger: CapturingLogger;
}

function harness(overrides: Parameters<typeof testConfig>[0] = {}, runner = new FakeRunner()): Harness {
  const counters = new OffloadCounters();
  const logger = new CapturingLogger();
  const listener = createPostExecuteListener({
    readConfig: () => testConfig(overrides),
    runner,
    counters,
    logger,
    globalGate: new Semaphore(testConfig(overrides).concurrency.maxWorkersGlobal),
    agentGate: new KeyedLimiter(testConfig(overrides).concurrency.maxWorkersPerAgent),
  });
  return { listener, runner, counters, logger };
}

describe("offload happy path (SPEC §39 AC1-AC8)", () => {
  it("replaces the model-facing content with the worker's compact answer", async () => {
    const { listener, runner, counters } = harness();
    const raw = makeText(4_096);
    const decision = await listener(fakeExec("read", { agent: fakeAgent({ userMessage: "Find the retry logic." }) }), successResult(raw), async () => accept);

    expect(decision.kind).toBe("accept");
    const content = (decision as { content?: { type: string; text: string }[] }).content;
    expect(content?.[0]?.text).toBe("compact answer");
    // Canonical value is never part of the decision (SPEC §39 AC8).
    expect((decision as { value?: unknown }).value).toBeUndefined();

    const request = runner.requests[0];
    expect(request?.label).toBe("dsh-tool-offload:read");
    expect(request?.prompt).toContain("<PARENT_TASK>");
    expect(request?.prompt).toContain("Find the retry logic.");
    expect(request?.prompt).toContain("name: read");
    expect(request?.prompt).toContain(raw);
    expect(request?.profile.subagentProvider).toBe("spawn");

    expect(counters.snapshot()).toMatchObject({ candidates: 1, started: 1, completed: 1, failed: 0, passthrough: 0 });
    expect(counters.snapshot().inputBytes).toBeGreaterThan(0);
    expect(counters.snapshot().outputBytes).toBe(byteLength("compact answer"));
  });

  it("forwards the parent cancellation signal to the runner (SPEC §22)", async () => {
    const { listener, runner } = harness();
    const controller = new AbortController();
    await listener(
      fakeExec("read", { agent: fakeAgent(), signal: controller.signal }),
      successResult(makeText(4_096)),
      async () => accept,
    );
    expect(runner.requests[0]?.signal).toBe(controller.signal);
  });

  it("prefixes the annotation marker when enabled (SPEC §6.4)", async () => {
    const { listener } = harness({ annotation: { enabled: true } });
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect((decision as { content?: { text: string }[] }).content?.[0]?.text.startsWith(OFFLOAD_ANNOTATION_MARKER)).toBe(true);
  });

  it("bounds the parent context passed to the worker (SPEC §9.3)", async () => {
    const { listener, runner } = harness({ context: { maxParentContextBytes: 2_048 } });
    const hugeTask = "task ".repeat(20_000);
    await listener(fakeExec("read", { agent: fakeAgent({ userMessage: hugeTask }) }), successResult(makeText(4_096)), async () => accept);
    expect(runner.requests[0]?.prompt.length).toBeLessThan(hugeTask.length);
  });
});

describe("routing bypasses (SPEC §39 AC9, AC10)", () => {
  const bypass = async (exec: ToolExecution, result: ToolExecutionResult, overrides: Parameters<typeof testConfig>[0] = {}) => {
    const { listener, runner, counters } = harness(overrides);
    const decision = await listener(exec, result, async () => accept);
    expect(decision).toEqual(accept);
    expect(runner.requests).toHaveLength(0);
    return counters.snapshot();
  };

  it("keeps small results untouched", async () => {
    const snapshot = await bypass(fakeExec("read", { agent: fakeAgent() }), successResult("tiny"));
    expect(snapshot.passthrough).toBe(1);
  });

  it("keeps denied tools untouched", async () => {
    const snapshot = await bypass(fakeExec("bash", { agent: fakeAgent() }), successResult(makeText(40_000)));
    expect(snapshot.passthrough).toBe(1);
  });

  it("keeps tools outside the allowlist untouched", async () => {
    const snapshot = await bypass(fakeExec("write", { agent: fakeAgent() }), successResult(makeText(40_000)));
    expect(snapshot.passthrough).toBe(1);
  });

  it("never touches failed results (SPEC §10.4)", async () => {
    const snapshot = await bypass(fakeExec("read", { agent: fakeAgent() }), errorResult(`Error: ${makeText(40_000)}`));
    expect(snapshot.candidates).toBe(1);
    expect(snapshot.started).toBe(0);
  });

  it("never touches results with non-text blocks", async () => {
    const result = {
      isError: false,
      value: null,
      content: [{ type: "image", data: makeText(40_000) }],
    } as unknown as ToolExecutionResult;
    const snapshot = await bypass(fakeExec("screenshot", { agent: fakeAgent() }), result);
    expect(snapshot.started).toBe(0);
  });

  it("honors the enabled flag without counting candidates", async () => {
    const snapshot = await bypass(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(40_000)), { enabled: false });
    expect(snapshot.candidates).toBe(0);
  });

  it("skips delegated child sessions (recursion guard, SPEC §25, AC15)", async () => {
    const snapshot = await bypass(fakeExec("read", { agent: fakeAgent({ origin: "subagent" }) }), successResult(makeText(40_000)));
    expect(snapshot.started).toBe(0);
  });

  it("skips code-mode sub-dispatches", async () => {
    const snapshot = await bypass(
      fakeExec("read", { agent: fakeAgent(), parent: Symbol("parent") as ToolExecution["parent"] }),
      successResult(makeText(40_000)),
    );
    expect(snapshot.candidates).toBe(0);
  });
});

describe("failure fallback (SPEC §22, §39 AC11-AC12)", () => {
  const failing = (outcome: Parameters<FakeRunner["respond"]>[0]) => harness({}, new FakeRunner().respond(outcome));

  it("returns the original decision when the worker is unavailable", async () => {
    const { listener } = failing({ kind: "unavailable", detail: "provider missing" });
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(decision).toEqual(accept);
  });

  it("returns the original decision when the worker fails", async () => {
    const { listener } = failing({ kind: "failed", detail: "boom" });
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(decision).toEqual(accept);
  });

  it("returns the original decision when the worker times out", async () => {
    const { listener } = failing({ kind: "timeout" });
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(decision).toEqual(accept);
  });

  it("returns the original decision when the parent cancelled the worker", async () => {
    const { listener } = failing({ kind: "aborted" });
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(decision).toEqual(accept);
  });

  it("returns the original decision when the worker answer is rejected by validation (SPEC §39 AC23)", async () => {
    const { listener } = harness({}, new FakeRunner().respond({ kind: "completed", outputText: makeText(4_096), stopReason: "completed" }));
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(decision).toEqual(accept);
  });

  it("applies the truncate fallback deterministically when configured", async () => {
    const { listener } = harness({ fallback: { mode: "truncate" } }, new FakeRunner().respond({ kind: "failed", detail: "boom" }));
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(40_000)), async () => accept);
    const text = (decision as { content?: { text: string }[] }).content?.[0]?.text ?? "";
    expect(text).toContain("bounded original");
    expect(byteLength(text)).toBeLessThan(25_000);
  });

  it("surfaces the failure in error fallback mode", async () => {
    const { listener } = harness({ fallback: { mode: "error" } }, new FakeRunner().respond({ kind: "failed", detail: "boom" }));
    const decision = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect((decision as { content?: { text: string }[] }).content?.[0]?.text ?? "").toContain("boom");
  });
});

describe("concurrency bounds (SPEC §24)", () => {
  it("routes results through untouched when the global budget is exhausted", async () => {
    const counters = new OffloadCounters();
    const logger = new CapturingLogger();
    let release: (() => void) | undefined;
    const slowRunner = {
      requests: [] as unknown[],
      run: async (_request: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { kind: "completed", outputText: "compact", stopReason: "completed" } as const;
      },
    };
    const config = testConfig({ concurrency: { maxWorkersGlobal: 1, maxWorkersPerAgent: 3 } });
    const listener = createPostExecuteListener({
      readConfig: () => config,
      runner: slowRunner as unknown as FakeRunner,
      counters,
      logger,
      globalGate: new Semaphore(1),
      agentGate: new KeyedLimiter(3),
    });
    const exec = fakeExec("read", { agent: fakeAgent() });
    const first = listener(exec, successResult(makeText(4_096)), async () => accept);
    const second = await listener(fakeExec("read", { agent: fakeAgent() }), successResult(makeText(4_096)), async () => accept);
    expect(second).toEqual(accept);
    release?.();
    await first;
    expect(counters.snapshot().started).toBe(1);
    expect(counters.snapshot().passthrough).toBe(1);
  });
});

describe("observability (SPEC §26)", () => {
  it("never logs raw tool content", async () => {
    const { listener, logger } = harness();
    const raw = makeText(4_096);
    await listener(fakeExec("read", { agent: fakeAgent() }), successResult(raw), async () => accept);
    const serialized = JSON.stringify(logger.records);
    expect(serialized).not.toContain(raw.slice(0, 64));
    expect(logger.events("offload.completed")).toHaveLength(1);
  });

  it("records skip reasons for passthrough decisions", async () => {
    const { listener, counters } = harness();
    await listener(fakeExec("bash", { agent: fakeAgent() }), successResult(makeText(40_000)), async () => accept);
    expect(counters.snapshot().reasons).toEqual({ "tool-denied": 1 });
  });
});
