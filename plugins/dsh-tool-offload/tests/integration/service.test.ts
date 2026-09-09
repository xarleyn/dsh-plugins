/**
 * Integration tests for the Cordis service wiring: listener registration via
 * the required `tools` + `subagents` services, end-to-end offload through the
 * service-built listener, stats surface, and dispose symmetry (guidelines
 * §6.2).
 */

import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";

import { ToolOffloadService } from "../../src/service.js";
import type { ToolOffloadConfig } from "../../src/config.js";
import type { ToolOffloadListener } from "../../src/integration/post-execute.js";
import { CapturingLogger, FakeRunner, fakeAgent, fakeExec, makeText, successResult } from "../fixtures/offload-fixtures.js";

interface Wiring {
  service: ToolOffloadService;
  ctx: Context;
  listeners: ToolOffloadListener[];
  runner: FakeRunner;
  logger: CapturingLogger;
}

function wire(overrides: ToolOffloadConfig = {}): Wiring {
  const ctx = new Context();
  const listeners: ToolOffloadListener[] = [];
  const host = {
    subagents: { start: async () => undefined as never, getProvider: () => undefined },
    on(event: "tools/post-execute", listener: ToolOffloadListener) {
      listeners.push(listener);
      return () => undefined;
    },
  };
  // The test harness has no `tools`/`subagents` services; capture the
  // registration callback synchronously instead of waiting for injection.
  (ctx as unknown as { inject: (services: readonly string[], cb: (c: unknown) => void) => () => void }).inject = (
    services,
    cb,
  ) => {
    expect(services).toEqual(["tools", "subagents"]);
    cb(host);
    return () => undefined;
  };
  const runner = new FakeRunner();
  const logger = new CapturingLogger();
  const service = new ToolOffloadService(
    ctx,
    { routing: { thresholds: { minBytes: 1_024, minEstimatedTokens: 256 } }, ...overrides },
    { logger, runner },
  );
  return { service, ctx, listeners, runner, logger };
}

describe("ToolOffloadService wiring", () => {
  it("registers exactly one post-execute listener requiring tools + subagents", () => {
    const { service, listeners } = wire();
    expect(listeners).toHaveLength(1);
    (service as unknown as { dispose(): void }).dispose();
  });

  it("offloads through the service-built listener and counts telemetry", async () => {
    const { service, listeners, runner } = wire();
    const listener = listeners[0]!;
    const raw = makeText(4_096);
    const decision = await listener(
      fakeExec("read", { agent: fakeAgent({ userMessage: "Find the retry logic." }) }),
      successResult(raw),
      async () => ({ kind: "accept" }),
    );
    expect((decision as { content?: { text: string }[] }).content?.[0]?.text).toBe("compact answer");
    expect(runner.requests).toHaveLength(1);
    expect(service.stats().runtime).toMatchObject({ candidates: 1, started: 1, completed: 1 });
    (service as unknown as { dispose(): void }).dispose();
  });

  it("exposes stats with runtime counters, derived metrics, and config summary", () => {
    const { service } = wire({ routing: { thresholds: { minBytes: 1_000 } } });
    const stats = service.stats();
    expect(stats.runtime.candidates).toBe(0);
    expect(stats.derived).toEqual({ reductionRatio: 0, avgDurationMs: 0, completionRate: 0, estimatedTokensSaved: 0 });
    expect(stats.config).toMatchObject({
      enabled: true,
      mode: "allowlist",
      defaultWorker: "default",
      fallbackMode: "original",
      thresholds: { minBytes: 1_000 },
    });
    expect(stats.config.workers).toContain("default");
    (service as unknown as { dispose(): void }).dispose();
  });
});

describe("ToolOffloadService dispose symmetry (guidelines §3.4)", () => {
  it("dispose is idempotent and does not throw", () => {
    const { service } = wire();
    const target = service as unknown as { dispose(): void };
    target.dispose();
    expect(() => target.dispose()).not.toThrow();
  });
});
