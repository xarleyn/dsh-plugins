import { describe, expect, it, vi } from "vitest";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { resolveConfig } from "../src/shared/config.js";
import { CallTelemetryStore } from "../src/host/telemetry-store.js";

const request: GenerateOptions = {
  provider: "sleev-openai",
  model: "model-a",
  messages: [],
};

describe("call telemetry store", () => {
  it("records usage without request content and applies the history bound", () => {
    let now = 100;
    let id = 0;
    const logger = { debug: vi.fn(), info: vi.fn() };
    const store = new CallTelemetryStore(
      logger,
      resolveConfig({ maxRecentCalls: 1 }),
      { now: () => now, createId: () => `call-${++id}` },
    );

    const first = store.begin(request, "one-shot");
    first.observeUsage({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 5,
    });
    now = 145;
    first.finish({ kind: "success" });

    const second = store.begin(request, "one-shot");
    now = 170;
    second.finish({ kind: "aborted" });

    const recent = store.listRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      callId: "call-2",
      durationMs: 25,
      result: { kind: "aborted" },
    });
    expect(JSON.stringify(recent)).not.toContain("messages");
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it("finalizes a handle only once", () => {
    const logger = { debug: vi.fn(), info: vi.fn() };
    const store = new CallTelemetryStore(logger, resolveConfig(), {
      now: () => 1,
      createId: () => "call",
    });
    const handle = store.begin(request, "one-shot");
    handle.finish({ kind: "success" });
    handle.finish({ kind: "error", code: "LATE" });
    expect(store.listRecent()).toHaveLength(1);
  });

  it("applies a changed retention bound without waiting for another call", () => {
    const logger = { debug: vi.fn(), info: vi.fn() };
    let config = resolveConfig({ maxRecentCalls: 3, logLevel: "off" });
    let id = 0;
    const store = new CallTelemetryStore(logger, () => config, {
      now: () => 1,
      createId: () => `call-${++id}`,
    });
    for (let index = 0; index < 3; index += 1) {
      store.begin(request, "one-shot").finish({ kind: "success" });
    }

    config = resolveConfig({ maxRecentCalls: 1, logLevel: "off" });
    store.reconfigure();

    expect(store.listRecent()).toMatchObject([{ callId: "call-3" }]);
  });
});
