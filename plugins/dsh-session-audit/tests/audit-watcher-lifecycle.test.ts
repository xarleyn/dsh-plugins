import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canonicalize: vi.fn(), watch: vi.fn() }));
vi.mock("@deepseek-ai/dsh-home-paths", () => ({
  canonicalizeWatchPath: mocks.canonicalize,
}));
vi.mock("chokidar", () => ({ watch: mocks.watch }));

import { AuditWatcher } from "../src/host/audit-watcher.js";

function pendingPath() {
  let resolve!: (path: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const created: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];
  mocks.watch.mockImplementation(() => {
    const watcher = Object.assign(new EventEmitter(), {
      close: vi.fn(async () => {}),
    });
    created.push(watcher);
    return watcher;
  });
  const recheck = vi.fn();
  const fallback = vi.fn();
  const watcher = new AuditWatcher({
    root: "synthetic-audits",
    watch: true,
    watchMode: "events",
    settleMs: 10,
    rescanIntervalMs: 1000,
    onRecheck: recheck,
    onFallback: fallback,
  });
  return { watcher, created, recheck, fallback };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AuditWatcher lifecycle", () => {
  it.each(["resolve", "reject"] as const)(
    "ignores a late canonicalization %s after stop",
    async (outcome) => {
      vi.useFakeTimers();
      const pending = pendingPath();
      mocks.canonicalize.mockReturnValueOnce(pending.promise);
      const { watcher, created, recheck, fallback } = fixture();
      const starting = watcher.start();
      await watcher.stop();
      if (outcome === "resolve") pending.resolve("synthetic-audits");
      else pending.reject(new Error("obsolete lookup"));
      await starting;
      await vi.advanceTimersByTimeAsync(2000);
      expect(created).toHaveLength(0);
      expect(recheck).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      await watcher.stop();
    },
  );

  it("allows restart while an earlier start is pending without adopting stale resources", async () => {
    vi.useFakeTimers();
    const old = pendingPath();
    mocks.canonicalize
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue("current-root");
    const { watcher, created, recheck, fallback } = fixture();
    const first = watcher.start();
    await watcher.stop();
    await watcher.start();
    old.resolve("obsolete-root");
    await first;
    expect(created).toHaveLength(1);
    expect(mocks.watch).toHaveBeenCalledWith("current-root", expect.anything());
    created[0]?.emit("all");
    await vi.advanceTimersByTimeAsync(60);
    expect(recheck).toHaveBeenCalledOnce();
    await watcher.stop();
    created[0]?.emit("all");
    created[0]?.emit("error", new Error("closed watcher"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(recheck).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(created[0]?.close).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent starts and closes the one acquired resource", async () => {
    const pending = pendingPath();
    mocks.canonicalize.mockReturnValue(pending.promise);
    const { watcher, created } = fixture();
    const first = watcher.start();
    const second = watcher.start();
    pending.resolve("synthetic-audits");
    await Promise.all([first, second]);
    expect(created).toHaveLength(1);
    await watcher.stop();
    await watcher.stop();
    expect(created[0]?.close).toHaveBeenCalledOnce();
  });
});
