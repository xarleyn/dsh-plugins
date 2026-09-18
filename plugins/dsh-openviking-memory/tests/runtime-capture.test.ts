/**
 * The runtime's write path, driven through the plugin's own listeners.
 *
 * Capture, commit, flush and dispose decide *what* to send and *when*; the only
 * place that decision is observable is the recorded transport, plus the pending
 * queue the offline path leaves on disk. Every assertion below is therefore
 * about a request, a queue file, or a plugin log record — never about private
 * runtime state, except for the documented `liveSessions` counter.
 */

import { rm } from "node:fs/promises";

import {
  subscribePluginLogRecords,
  type PluginLogRecord,
} from "@yadsh/dsh-plugin-log";
import { afterEach, describe, expect, it } from "vitest";

import { enqueue, listPending } from "../src/openviking/pending-queue.js";
import {
  createFakeSession,
  createHarness,
  emit,
  type Harness,
} from "./helpers/harness.js";
import {
  captureEvent,
  failure,
  ok,
  ovId,
  ovPath,
  pendingFiles,
  transport,
} from "./runtime.helpers.js";

let harness: Harness | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  for (const dir of tempDirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe("capture and the pending queue", () => {
  it("queues a retryable capture failure but drops a permanent client error", async () => {
    for (const [status, expected] of [
      [503, 1],
      [400, 0],
    ] as const) {
      const sessionId = `dsh-capture-${status}`;
      const messages = ovPath(ovId(sessionId), "/messages");
      const session = createFakeSession(sessionId, {
        cwd: "/workspace/project",
      });
      const local = await createHarness(
        {},
        {
          fetchImpl: transport({ [messages]: () => failure(status) }),
        },
      );

      await emit(
        local,
        "session/event",
        session,
        captureEvent(`Remember the HTTP ${status} behaviour.`),
      );
      await emit(local, "session/flush", session);

      expect(await pendingFiles(), `HTTP ${status}`).toHaveLength(expected);
      if (expected === 1) {
        const pending = await listPending();
        expect(pending[0]!.entry.type).toBe("addMessage");
        expect(pending[0]!.entry.sessionId).toBe(ovId(sessionId));
      }

      await local.dispose();
    }
  });

  it("queues a capture only when the initialization failure is retryable", async () => {
    for (const [status, expected] of [
      [503, 1],
      [400, 0],
    ] as const) {
      const sessionId = `dsh-init-${status}`;
      const ovSession = ovId(sessionId);
      const session = createFakeSession(sessionId, {
        cwd: "/workspace/project",
      });
      const local = await createHarness(
        {},
        {
          fetchImpl: transport({
            // The session-ensure call fails; the message itself would succeed, so
            // a stale `hasPendingWrites` latch is the only way this test passes
            // when the initialization failure should have been dropped.
            "/api/v1/sessions": () => failure(status),
            [ovPath(ovSession, "/messages")]: () => ok({}),
          }),
        },
      );

      await emit(
        local,
        "session/event",
        session,
        captureEvent(`Remember the init ${status} behaviour.`),
      );
      await emit(local, "session/flush", session);

      expect(await pendingFiles(), `HTTP ${status}`).toHaveLength(expected);
      expect(
        local.requestsFor(ovPath(ovSession, "/messages")),
        `HTTP ${status}`,
      ).toHaveLength(0);

      await local.dispose();
    }
  });

  it("queues a retryable threshold commit failure", async () => {
    const sessionId = "dsh-commit-fail";
    const ovSession = ovId(sessionId);
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    harness = await createHarness(
      {},
      {
        fetchImpl: transport({
          [ovPath(ovSession)]: () => ok({ pending_tokens: 50000 }),
          [ovPath(ovSession, "/commit")]: () => failure(503, "UNAVAILABLE"),
        }),
      },
    );

    await emit(harness, "session/event", session, {
      type: "turn/end",
      time: Date.now(),
      data: {},
    });
    await emit(harness, "session/flush", session);

    expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
    const pending = await listPending();
    expect(pending.map((item) => item.entry.type)).toEqual(["commitSession"]);
    expect(pending[0]!.entry.payload).toEqual({ keep_recent_count: 10 });
  });

  it("keeps queued messages and the final commit ordered on disk", async () => {
    const sessionId = "dsh-order";
    const ovSession = ovId(sessionId);
    const messages = ovPath(ovSession, "/messages");
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    harness = await createHarness(
      {},
      { fetchImpl: transport({ [messages]: () => failure(503) }) },
    );

    await emit(
      harness,
      "session/event",
      session,
      captureEvent("First queued message."),
    );
    await emit(harness, "session/flush", session);
    await emit(
      harness,
      "session/event",
      session,
      captureEvent("Second queued message."),
    );
    await emit(harness, "session/flush", session);

    // The latch holds after the first failure: the second turn never hits the wire.
    expect(harness.requestsFor(messages)).toHaveLength(1);
    let pending = await listPending();
    expect(pending.map((item) => item.entry.type)).toEqual([
      "addMessage",
      "addMessage",
    ]);
    const createdAt = pending.map((item) => item.entry.createdAt);
    // Strictly increasing, not merely non-decreasing: a tie would make the
    // queue's readdir order, not `createdAt`, decide the replay order.
    expect(createdAt[1]!).toBeGreaterThan(createdAt[0]!);
    expect(createdAt).toEqual(
      [...createdAt].sort((left, right) => left - right),
    );

    // A turn/end while the latch holds neither reads the session nor commits.
    await emit(harness, "session/event", session, {
      type: "turn/end",
      time: Date.now(),
      data: {},
    });
    await emit(harness, "session/flush", session);
    expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(0);
    expect(harness.requestsFor(ovPath(ovSession))).toHaveLength(0);
    expect(await listPending()).toHaveLength(2);

    // An older pending commit is superseded by a newer message: the commit is
    // dropped (upstream's `removePendingCommits`) and the message is appended,
    // so the queue stays one ordered run of writes.
    const commit = await enqueue(
      "commitSession",
      ovSession,
      { keep_recent_count: 10 },
      { createdAt: Date.now() + 10_000 },
    );
    expect(commit.ok).toBe(true);
    expect((await listPending()).map((item) => item.entry.type)).toEqual([
      "addMessage",
      "addMessage",
      "commitSession",
    ]);

    await emit(
      harness,
      "session/event",
      session,
      captureEvent("Third queued message."),
    );
    await emit(harness, "session/flush", session);
    pending = await listPending();
    expect(pending.map((item) => item.entry.type)).toEqual([
      "addMessage",
      "addMessage",
      "addMessage",
    ]);
    expect(
      pending.map(
        (item) =>
          (item.entry.payload as { parts?: { text?: string }[] }).parts?.[0]
            ?.text,
      ),
    ).toEqual([
      "First queued message.",
      "Second queued message.",
      "Third queued message.",
    ]);
    const afterSupersede = pending.map((item) => item.entry.createdAt);
    expect(afterSupersede).toEqual(
      [...afterSupersede].sort((left, right) => left - right),
    );
  });
});

describe("commit threshold", () => {
  it("commits only past the threshold and records the server trace id", async () => {
    let pendingTokens = 5;
    const sessionId = "dsh-threshold";
    const ovSession = ovId(sessionId);
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    const records: PluginLogRecord[] = [];
    const unsubscribe = subscribePluginLogRecords((record) =>
      records.push(record),
    );

    try {
      harness = await createHarness(
        { commitTokenThreshold: 20000 },
        {
          fetchImpl: transport({
            [ovPath(ovSession)]: () => ok({ pending_tokens: pendingTokens }),
            [ovPath(ovSession, "/commit")]: () =>
              ok({ trace_id: "trace-server-1" }),
          }),
        },
      );

      await emit(harness, "session/event", session, {
        type: "turn/end",
        time: Date.now(),
        data: {},
      });
      await emit(harness, "session/flush", session);
      expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(0);
      expect(
        records.filter((record) => record.event === "commit"),
      ).toHaveLength(0);

      pendingTokens = 50000;
      await emit(harness, "session/event", session, {
        type: "turn/end",
        time: Date.now(),
        data: {},
      });
      await emit(harness, "session/flush", session);

      expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
      const commits = records.filter((record) => record.event === "commit");
      expect(commits).toHaveLength(1);
      expect(commits[0]!.fields).toMatchObject({
        sessionId: ovSession,
        ok: true,
        trace_id: "trace-server-1",
      });
    } finally {
      unsubscribe();
    }
  });
});
