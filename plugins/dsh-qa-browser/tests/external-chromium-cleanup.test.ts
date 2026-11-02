import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stopExternalChromium,
  withExternalChromium,
} from "./external-chromium.helpers.js";
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<object>()),
  rm: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function childProcess(exitsOnKill = true) {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { exitCode: null, signalCode: null });
  child.kill = vi.fn(() => {
    if (exitsOnKill) {
      Object.assign(child, { signalCode: "SIGTERM" });
      child.emit("exit", null, "SIGTERM");
    }
    return true;
  });
  return child;
}
class Socket extends EventTarget {
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send = vi.fn(() =>
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", { data: '{"id":1,"result":{}}' }),
      ),
    ),
  );
  close = vi.fn();
}
function endpoint() {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/synthetic",
      }),
    })),
  );
}
describe("external Chromium teardown", () => {
  it("waits for its own fallback kill instead of treating a slow Browser.close as failed teardown", async () => {
    endpoint();
    const child = childProcess();
    const result = stopExternalChromium(child, 12345).then(
      () => "exited",
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toBe("exited");
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it("does not contact or kill an already exited process", async () => {
    endpoint();
    const child = childProcess();
    Object.assign(child, { exitCode: 0 });
    await stopExternalChromium(child, 12345);
    expect(fetch).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
  it("bounds a stuck WebSocket open and removes its exit listener after an unkillable process times out", async () => {
    endpoint();
    vi.stubGlobal(
      "WebSocket",
      class extends EventTarget {
        close() {}
      },
    );
    const child = childProcess(false);
    const result = stopExternalChromium(child, 12345).catch((error) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toMatchObject({
      message: "the external Chromium outlived its own teardown",
    });
    expect(child.listenerCount("exit")).toBe(0);
  });
  it("preserves the test failure and still closes independent fixtures when process cleanup fails", async () => {
    endpoint();
    const child = childProcess(false),
      primary = new Error("assertion failed"),
      after = vi.fn(async () => {});
    const result = withExternalChromium(
      { child, userDataDir: "synthetic-profile" },
      12345,
      async () => {
        throw primary;
      },
      after,
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({
      cause: primary,
      errors: [primary, expect.any(Error)],
    });
    expect(after).toHaveBeenCalledOnce();
    expect(rm).not.toHaveBeenCalled();
  });
  it("removes only its owned exited profile while preserving a primary failure", async () => {
    endpoint();
    const child = childProcess(),
      primary = new Error("assertion failed"),
      after = vi.fn(async () => {});
    const result = withExternalChromium(
      { child, userDataDir: "synthetic-profile" },
      12345,
      async () => {
        throw primary;
      },
      after,
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toBe(primary);
    expect(rm).toHaveBeenCalledWith("synthetic-profile", expect.any(Object));
    expect(after).toHaveBeenCalledOnce();
  });
});
