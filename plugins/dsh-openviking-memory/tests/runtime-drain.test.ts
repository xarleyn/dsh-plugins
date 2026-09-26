/**
 * The offline queue as the drainer replays it.
 *
 * Capture survives an outage by writing to disk, so the queue is only worth
 * having if the replay eventually sends what it holds: a message that never
 * leaves the queue is a message that was never remembered. What decides whether
 * a replayed write is sent — and sent as whom — is the routing identity the
 * entry carries, the one thing that has to survive a recovered server, a
 * restart, and an account whose session is not back yet.
 */

import { afterEach, describe, expect, it } from "vitest";

import { enqueue, listPending } from "../src/openviking/pending-queue.js";
import {
  createFakeAgent,
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

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** A QA surface that attributes exactly the sessions a test names. */
function surfaceFor(owners: Record<string, string>): {
  principalForSession(
    sessionId: string,
  ): { readonly userId: string } | undefined;
  principalForToken(token: string): { readonly userId: string } | undefined;
} {
  return {
    principalForSession: (sessionId) => {
      const userId = owners[sessionId];
      return userId === undefined ? undefined : { userId };
    },
    principalForToken: (token) => {
      const userId = owners[token];
      return userId === undefined ? undefined : { userId };
    },
  };
}

describe("the drainer's replay", () => {
  it("sends a queued write once the server recovers", async () => {
    let down = true;
    const sessionId = "dsh-drain";
    const messages = ovPath(ovId(sessionId), "/messages");
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    harness = await createHarness(
      { user: "shared-account" },
      {
        // A deployment-wide identity: one memory space for everybody, and the
        // scoping that allows it without ever naming a user.
        fetchImpl: transport({
          [messages]: () => (down ? failure(503) : ok({})),
        }),
      },
    );

    await emit(
      harness,
      "session/event",
      session,
      captureEvent("Remember this."),
    );
    await emit(harness, "session/flush", session);

    const queued = (await listPending())[0]!;
    expect(queued.entry.sessionId).toBe(ovId(sessionId));
    expect(harness.requestsFor(messages)).toHaveLength(1);

    down = false;
    await harness.plugin.runtime.drainTick();

    expect(harness.requestsFor(messages)).toHaveLength(2);
    expect(harness.requestsFor(messages)[1]!.headers["X-OpenViking-User"]).toBe(
      "shared-account",
    );
    expect(await pendingFiles()).toEqual([]);
    // And the entry it waited in says whose write it was, so a replay never has
    // to guess the space from a session that may not be back.
    expect(queued.entry.user).toBe("shared-account");
  });

  it("sends an entry as the account that queued it, without that session", async () => {
    harness = await createHarness(
      {},
      { fetchImpl: transport(), qaSurface: surfaceFor({}) },
    );

    // A restart: the backlog is on disk, its session has not been resumed, and
    // nothing in this process connects the two — only the entry does.
    await enqueue(
      "addMessage",
      "dsh-gone",
      { content: "queued as account-b" },
      { createdAt: Date.now(), user: "account-b" },
    );

    await harness.plugin.runtime.drainTick();

    const sent = harness.requestsFor(ovPath("dsh-gone", "/messages"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers["X-OpenViking-User"]).toBe("account-b");
    expect(await pendingFiles()).toEqual([]);
  });

  it("waits rather than guesses for an entry that names no identity", async () => {
    harness = await createHarness(
      {},
      {
        fetchImpl: transport(),
        qaSurface: surfaceFor({ "dsh-live": "account-a" }),
      },
    );

    // Per-account spaces are in play: this process does speak as an account.
    const { agent } = createFakeAgent({ sessionId: "dsh-live" });
    await emit(harness, "agent/created", { agent });

    // An entry written before the queue recorded an identity, for a session
    // this process has never seen. Either account could be the wrong one.
    await enqueue("addMessage", "dsh-gone", { content: "unattributed" }, {});

    await harness.plugin.runtime.drainTick();

    expect(harness.requestsFor(ovPath("dsh-gone", "/messages"))).toEqual([]);
    const held = await listPending();
    expect(held.map((item) => item.entry.sessionId)).toEqual(["dsh-gone"]);
    expect(held[0]!.entry.user).toBeUndefined();
  });
});
