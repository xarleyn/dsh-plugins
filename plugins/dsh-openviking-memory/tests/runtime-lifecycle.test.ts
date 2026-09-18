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

describe("flush", () => {
  it("waits only for the session it was asked about", async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondStarted!: () => void;
    const secondReachedTheGate = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    const first = createFakeSession("first", { cwd: "/workspace/first" });
    const second = createFakeSession("second", { cwd: "/workspace/second" });
    harness = await createHarness(
      {},
      {
        fetchImpl: transport({
          // Gate the second session's initialization, i.e. before any of its own
          // writes can reach the wire. The shared ensure-session endpoint tells
          // the two sessions apart by the id in its body.
          "/api/v1/sessions": async (init) => {
            const body = init?.body === undefined ? "" : String(init.body);
            if (body.includes(ovId("second"))) {
              secondStarted();
              await secondGate;
            }
            return ok({});
          },
        }),
      },
    );

    await emit(
      harness,
      "session/event",
      first,
      captureEvent("A fact for the first session."),
    );
    await emit(
      harness,
      "session/event",
      second,
      captureEvent("A fact for the second session."),
    );
    await secondReachedTheGate;

    await emit(harness, "session/flush", first);
    expect(
      harness.requestsFor(ovPath(ovId("first"), "/messages")),
    ).toHaveLength(1);
    expect(
      harness.requestsFor(ovPath(ovId("second"), "/messages")),
    ).toHaveLength(0);

    // Flushing the second session does block on its own pending write...
    let settled = false;
    const flushingSecond = emit(harness, "session/flush", second).then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(settled).toBe(false);

    // ...and releases it as soon as that write is done.
    releaseSecond();
    await flushingSecond;
    expect(
      harness.requestsFor(ovPath(ovId("second"), "/messages")),
    ).toHaveLength(1);
  });
});

describe("dispose", () => {
  it("drains the final commit before deleting the session state, and is safe twice", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let commitStarted!: () => void;
    const commitInFlight = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });

    const ovSession = ovId("dispose");
    harness = await createHarness(
      {},
      {
        fetchImpl: transport({
          [ovPath(ovSession, "/commit")]: async () => {
            commitStarted();
            await commitGate;
            return ok({ trace_id: "shutdown" });
          },
        }),
      },
    );
    const fake = createFakeAgent({
      sessionId: "dispose",
      cwd: "/workspace/dispose",
    });

    await emit(harness, "agent/session-start", {
      agent: fake.agent,
      source: "startup",
    });
    await emit(
      harness,
      "session/event",
      fake.agent.session,
      captureEvent("A turn worth remembering."),
    );
    await emit(harness, "session/flush", fake.agent.session);

    // The session-start listener registered exactly one disposer: the runtime's
    // per-session shutdown.
    expect(harness.requestsFor(ovPath(ovSession, "/messages"))).toHaveLength(1);
    expect(harness.plugin.runtime.liveSessions).toBe(1);
    expect(fake.sessionDisposers).toHaveLength(1);

    const disposing = fake.sessionDisposers[0]!();
    await commitInFlight;

    // The state is still tracked while its final write is in flight, so a
    // second dispose cannot race the first one's commit.
    expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
    expect(harness.plugin.runtime.liveSessions).toBe(1);

    releaseCommit();
    await disposing;

    const commits = harness.requestsFor(ovPath(ovSession, "/commit"));
    expect(commits).toHaveLength(1);
    expect(commits[0]!.body).toEqual({ keep_recent_count: 10 });
    expect(harness.plugin.runtime.liveSessions).toBe(0);

    await fake.sessionDisposers[0]!();
    expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
    expect(await pendingFiles()).toEqual([]);
  });

  it("disposeAll drains every live session through the plugin's lifecycle disposer", async () => {
    harness = await createHarness();
    const one = createFakeSession("one", { cwd: "/workspace/one" });
    const two = createFakeSession("two", { cwd: "/workspace/two" });

    await emit(
      harness,
      "session/event",
      one,
      captureEvent("First session turn."),
    );
    await emit(
      harness,
      "session/event",
      two,
      captureEvent("Second session turn."),
    );
    await emit(harness, "session/flush", one);
    await emit(harness, "session/flush", two);
    expect(harness.plugin.runtime.liveSessions).toBe(2);

    const lifecycle = harness.disposers.find((entry) =>
      entry.name.endsWith(".lifecycle"),
    );
    expect(lifecycle).toBeDefined();
    await lifecycle!.dispose();

    expect(harness.requestsFor(ovPath(ovId("one"), "/commit"))).toHaveLength(1);
    expect(harness.requestsFor(ovPath(ovId("two"), "/commit"))).toHaveLength(1);
    expect(harness.plugin.runtime.liveSessions).toBe(0);
  });
});

describe("syncTurns: false", () => {
  it("sends nothing: no capture, no commit, no dispose flush and no replay", async () => {
    // `autoInject: false` is what keeps the startup profile read out of the
    // request log; `syncTurns: false` is the write toggle under test.
    harness = await createHarness({ autoInject: false, syncTurns: false });
    const leftover = await enqueue(
      "addMessage",
      "dsh-earlier",
      { content: "queued while capture was on" },
      { createdAt: Date.now() - 1000 },
    );
    expect(leftover.ok).toBe(true);

    const fake = createFakeAgent({
      sessionId: "dsh-sync-off",
      cwd: "/workspace/off",
    });
    await emit(harness, "agent/session-start", {
      agent: fake.agent,
      source: "startup",
    });
    await emit(
      harness,
      "session/event",
      fake.agent.session,
      captureEvent("Never sent."),
    );
    await emit(harness, "session/event", fake.agent.session, {
      type: "turn/end",
      time: Date.now(),
      data: {},
    });
    await emit(harness, "session/flush", fake.agent.session);
    await fake.sessionDisposers[0]!();

    expect(harness.requests).toEqual([]);

    // The recall path reaches initialization even when nothing is captured, and
    // the toggle takes the replay out of it without taking the reads with it.
    // That is why this probe runs after the assertion above: it is the only
    // step in this test that is allowed to touch the wire.
    const state = await harness.plugin.runtime.initialize(fake.agent);
    expect(state.ready).toBe(true);
    expect(harness.paths()).toEqual(["/health", "/api/v1/sessions"]);

    const pending = await listPending();
    expect(pending.map((item) => item.entry.sessionId)).toEqual([
      "dsh-earlier",
    ]);
    expect(pending[0]!.entry.retries).toBe(0);
  });
});
