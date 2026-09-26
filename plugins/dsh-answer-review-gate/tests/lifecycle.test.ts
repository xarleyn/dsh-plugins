import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GateHostContext } from "../src/index.js";

// The plugin obtains its logger from the shared package and the only resource
// outside the plugin fiber is that logger's file handle, so the unload path is
// pinned by a controllable mock that reports whether `close()` completed.
const loggerState = vi.hoisted(() => ({
  closed: false,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  close: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    loggerState.closed = true;
  }),
}));

vi.mock("@yadsh/dsh-plugin-log", () => ({
  getPluginLogger: () => ({
    info: loggerState.info,
    warn: loggerState.warn,
    error: loggerState.error,
    close: loggerState.close,
  }),
}));

const { apply } = await import("../src/index.js");

function makeHost(services: Record<string, unknown> = {}): GateHostContext {
  return {
    on: () => () => {},
    get: (service) => services[service],
    inject: (_names, callback) =>
      callback({ commands: { register: () => () => {} } }),
  };
}

describe("plugin unload lifecycle", () => {
  beforeEach(() => {
    loggerState.closed = false;
    vi.clearAllMocks();
  });

  it("returns a disposer that closes the logger for an enabled plugin", async () => {
    const dispose = apply(makeHost({}), {
      reviewer: { backend: "domain-expert" },
    });
    expect(typeof dispose).toBe("function");
    expect(loggerState.closed).toBe(false);
    await dispose();
    // Reaches true only if the disposer awaits the asynchronous close.
    expect(loggerState.closed).toBe(true);
  });

  it("closes the logger even when the plugin is disabled", async () => {
    const dispose = apply(makeHost({}), { enabled: false });
    expect(loggerState.closed).toBe(false);
    await dispose();
    expect(loggerState.closed).toBe(true);
  });

  it("supports a hot-reload cycle: dispose frees the handle for the next apply", async () => {
    const first = apply(makeHost({}));
    await first();
    expect(loggerState.closed).toBe(true);

    loggerState.closed = false;
    const second = apply(makeHost({}));
    expect(loggerState.closed).toBe(false);
    await second();
    expect(loggerState.closed).toBe(true);
    expect(loggerState.close).toHaveBeenCalledTimes(2);
  });
});
