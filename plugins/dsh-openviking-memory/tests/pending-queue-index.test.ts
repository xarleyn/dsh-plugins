import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  claimForReplay,
  enqueue,
  listPending,
  queueSessionWrite,
  replayPending,
  type ReplaySummary,
} from "../src/openviking/pending-queue.js";
import { BASE, dir } from "./pending-queue.helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, readdir: vi.fn(fs.readdir), readFile: vi.fn(fs.readFile) };
});

afterEach(() => vi.clearAllMocks());

it("deduplicates legacy files and supersedes only the owning session's queued commits after restart", async () => {
  const msg = await enqueue(
    "addMessage",
    "first",
    { content: "old" },
    { createdAt: BASE },
  );
  const first = await enqueue(
    "commitSession",
    "first",
    {},
    { createdAt: BASE + 1 },
  );
  const other = await enqueue(
    "commitSession",
    "other",
    {},
    { createdAt: BASE + 2 },
  );
  for (const item of [msg, first, other]) {
    await rename(join(dir, item.path!), join(dir, basename(item.path!)));
  }
  const again = await queueSessionWrite(
    "addMessage",
    "first",
    { content: "old" },
    { createdAt: BASE + 3 },
  );
  expect(again).toMatchObject({ deduped: true, path: basename(msg.path!) });
  const fetch = vi.fn(async () => ({ ok: true }));
  await replayPending(fetch, () => {});
  expect(fetch.mock.calls).toEqual([
    ["/api/v1/sessions/first/messages", expect.anything(), {}],
    ["/api/v1/sessions/other/commit", expect.anything(), {}],
  ]);
});

it("a legacy claim blocks successors from that session while other sessions can proceed", async () => {
  const filename = "old-message_0.json";
  await writeFile(
    join(dir, filename),
    JSON.stringify({
      sessionId: "first",
      type: "addMessage",
      createdAt: BASE,
      payload: { content: "old" },
      retries: 0,
      dedupKey: "old-message",
    }),
  );
  await claimForReplay(filename);
  await enqueue("commitSession", "first", {}, { createdAt: BASE + 1 });
  await enqueue(
    "addMessage",
    "other",
    { content: "separate" },
    { createdAt: BASE + 2 },
  );
  const sent = vi.fn(async () => ({ ok: true }));
  await replayPending(sent, () => {});
  expect(sent.mock.calls).toEqual([
    ["/api/v1/sessions/other/messages", expect.anything(), {}],
  ]);
  expect((await listPending(true)).map((item) => item.entry.sessionId)).toEqual(
    ["first", "first"],
  );
});

it.each([
  ["modern", 1],
  ["legacy", 1],
  ["modern", 0],
  ["legacy", 0],
] as const)(
  "preserves a %s final commit when a delayed message is %i ms earlier",
  async (layout, delay) => {
    const commit = await queueSessionWrite(
      "commitSession",
      "chat",
      {},
      { createdAt: BASE + delay },
    );
    if (layout === "legacy")
      await rename(join(dir, commit.path!), join(dir, basename(commit.path!)));
    await queueSessionWrite(
      "addMessage",
      "chat",
      { content: "delayed" },
      { createdAt: BASE },
    );
    const delivered: string[] = [];
    await replayPending(
      async (path) => {
        delivered.push(path);
        return { ok: true };
      },
      () => {},
    );
    expect(delivered).toEqual([
      "/api/v1/sessions/chat/messages",
      "/api/v1/sessions/chat/commit",
    ]);
  },
);

it.each([
  ["addMessage", 400, true],
  ["addMessage", 200, true],
  ["commitSession", 503, true],
  ["commitSession", 503, false],
] as const)(
  "losing a %s lease on HTTP %i (consumeRetries=%s) holds the session for its new owner",
  async (first, status, consumeRetries) => {
    const next = first === "addMessage" ? "commitSession" : "addMessage";
    await enqueue(first, "chat", { content: "first" }, { createdAt: BASE });
    await enqueue(next, "chat", { content: "next" }, { createdAt: BASE + 1 });
    const clock = vi.spyOn(Date, "now");
    const afterExpiry = Date.now() + 11 * 60_000;
    const sentByA: string[] = [];
    const sentByB: string[] = [];
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondPass: Promise<ReplaySummary> | undefined;
    try {
      await replayPending(
        async (path) => {
          sentByA.push(path);
          if (sentByA.length > 1) return { ok: true };
          clock.mockReturnValue(afterExpiry);
          secondPass = replayPending(
            async (secondPath) => {
              if (sentByB.length === 0) {
                started();
                await resume;
              }
              sentByB.push(secondPath);
              return { ok: true };
            },
            () => {},
          );
          await entered;
          return {
            ok: status === 200,
            status,
            error: status === 400 ? { code: "BAD_REQUEST" } : null,
          };
        },
        () => {},
        { consumeRetries },
      );
      expect(sentByA).toHaveLength(1);
      expect(sentByB).toEqual([]);
    } finally {
      release();
      try {
        await secondPass;
      } finally {
        clock.mockRestore();
      }
    }
    expect(sentByB).toEqual(
      first === "addMessage"
        ? ["/api/v1/sessions/chat/messages", "/api/v1/sessions/chat/commit"]
        : ["/api/v1/sessions/chat/commit", "/api/v1/sessions/chat/messages"],
    );
    expect(await listPending(true)).toEqual([]);
  },
);

it("growing an offline backlog examines a bounded number of names and payloads per message", async () => {
  // A new process can have a sizeable flat backlog written by its predecessor.
  const batch = 12;
  for (let i = 0; i < batch; i++) {
    await writeFile(
      join(dir, `legacy-${i}.json`),
      JSON.stringify({
        type: "addMessage",
        sessionId: "old",
        createdAt: BASE + i,
        retries: 0,
        dedupKey: String(i),
        payload: { content: String(i) },
      }),
    );
  }
  const measure = async (start: number) => {
    vi.clearAllMocks();
    for (let i = start; i < start + batch; i++) {
      expect(
        (
          await queueSessionWrite(
            "addMessage",
            "busy",
            { content: String(i) },
            { createdAt: BASE + i },
          )
        ).ok,
      ).toBe(true);
    }
    const directories = vi.mocked(readdir).mock.settledResults;
    const visited = directories.reduce(
      (sum, r) => sum + (r.type === "fulfilled" ? r.value.length : 0),
      0,
    );
    return { visited, parsed: vi.mocked(readFile).mock.calls.length };
  };
  const first = await measure(0);
  const second = await measure(batch);
  expect(first.parsed).toBe(batch);
  expect(first.visited).toBeLessThan(4 * batch);
  expect(second.parsed).toBe(0);
  expect(second.visited).toBeLessThan(batch);
});

it("keeps a final commit for new messages when an earlier commit is already claimed", async () => {
  const older = await queueSessionWrite(
    "commitSession",
    "chat",
    {},
    { createdAt: BASE },
  );
  const claimed = await claimForReplay(older.path!);
  await queueSessionWrite(
    "addMessage",
    "chat",
    { content: "new" },
    { createdAt: BASE + 1 },
  );
  await Promise.all([
    queueSessionWrite("commitSession", "chat", {}, { createdAt: BASE + 2 }),
    queueSessionWrite("commitSession", "chat", {}, { createdAt: BASE + 3 }),
  ]);
  const pending = await listPending(true);
  expect(pending.map((item) => item.entry.createdAt)).toEqual([
    BASE,
    BASE + 1,
    BASE + 3,
  ]);
  expect(pending[0]!.filename).toBe(claimed);
});
