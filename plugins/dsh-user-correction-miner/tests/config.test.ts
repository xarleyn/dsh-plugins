import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";

describe("user correction miner config", () => {
  it("resolves retention and live pending bounds", () => {
    expect(resolveConfig()).toMatchObject({
      retention: DEFAULT_CONFIG.retention,
      live: DEFAULT_CONFIG.live,
    });
    expect(
      resolveConfig({
        retention: { maxRecordsPerWorkspace: 25 },
        live: {
          maxPendingSessions: 3,
          maxPendingEventsPerSession: 4,
          pendingTtlMs: 5_000,
        },
      }),
    ).toMatchObject({
      retention: { maxRecordsPerWorkspace: 25 },
      live: {
        maxPendingSessions: 3,
        maxPendingEventsPerSession: 4,
        pendingTtlMs: 5_000,
      },
    });
  });

  it.each([
    ["retention.maxRecordsPerWorkspace", { retention: { maxRecordsPerWorkspace: 0 } }],
    ["live.maxPendingSessions", { live: { maxPendingSessions: 0 } }],
    ["live.maxPendingEventsPerSession", { live: { maxPendingEventsPerSession: 0 } }],
    ["live.pendingTtlMs", { live: { pendingTtlMs: 0 } }],
  ] as const)("rejects invalid %s", (name, config) => {
    expect(() => resolveConfig(config)).toThrow(`${name} must be a positive safe integer`);
  });
});
