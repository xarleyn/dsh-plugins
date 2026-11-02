import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenVikingClient } from "../src/api-client.js";
import { resolveConfig } from "../src/config.js";
import {
  claimForReplay,
  dequeue,
  enqueue,
  incrementRetry,
  listPending,
  replayPending,
} from "../src/openviking/pending-queue.js";
import { dir, readEntry } from "./pending-queue.helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("durable transport acknowledgement", () => {
  it("preserves an explicit non-JSON HTTP refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>denied</html>", { status: 401 })),
    );
    const client = new OpenVikingClient(
      resolveConfig({ endpoint: "https://memory.example.com" }, {}),
    );
    expect(await client.addMessage("synthetic", {})).toMatchObject({
      ok: false,
      status: 401,
    });
  });
  it.each(["<html>proxy failure</html>", '{"status":"ok","result":', "null"])(
    "retains queued operations after an unreadable success: %s",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status: 200 })),
      );
      const client = new OpenVikingClient(
        resolveConfig({ endpoint: "https://memory.example.com" }, {}),
      );
      const result = await client.addMessage("synthetic", { content: "keep" });
      expect(result).toMatchObject({ ok: false, status: 0 });
      await enqueue("addMessage", "synthetic", { content: "keep" });
      const summary = await replayPending(
        (route, init) => client.fetchJSON(route, init),
        () => {},
        { consumeRetries: false },
      );
      expect(summary.replayed).toBe(0);
      expect(await listPending()).toHaveLength(1);
    },
  );

  it("does not recover a fresh claim merely because its queued file is old", async () => {
    const queued = await enqueue("addMessage", "synthetic", {
      content: "backlog",
    });
    const old = new Date(Date.now() - 11 * 60_000);
    await utimes(join(dir, queued.path!), old, old);
    const claimed = await claimForReplay(queued.path!);
    expect(claimed).not.toBeNull();
    expect(await listPending()).toEqual([]);
    expect(await readdir(dir)).toEqual([claimed]);
  });

  it("recovers an expired lease and keeps a late acknowledgement from deleting its successor", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const queued = await enqueue("addMessage", "synthetic", {
      content: "lease",
    });
    const first = await claimForReplay(queued.path!);
    clock.mockReturnValue(now + 11 * 60_000);
    expect(await listPending()).toHaveLength(1);
    const second = await claimForReplay(queued.path!);
    expect(second).not.toBe(first);
    expect(await dequeue(first!)).toBe(false);
    const entry = await readEntry(second!);
    expect(await incrementRetry(first!, entry)).toBe(false);
    expect(await readdir(dir)).toEqual([second]);
  });
});
