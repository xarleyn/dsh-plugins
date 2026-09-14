/**
 * The runtime's write path, driven through the plugin's own listeners.
 *
 * Capture, commit, flush and dispose decide *what* to send and *when*; the only
 * place that decision is observable is the recorded transport, plus the pending
 * queue the offline path leaves on disk. Every assertion below is therefore
 * about a request, a queue file, or a plugin log record — never about private
 * runtime state, except for the documented `liveSessions` counter.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { subscribePluginLogRecords, type PluginLogRecord } from "@yadsh/dsh-plugin-log";
import { afterEach, describe, expect, it } from "vitest";

import type { Config } from "../src/index.js";
import { enqueue, listPending } from "../src/openviking/pending-queue.js";
import {
  createFakeAgent,
  createFakeSession,
  createHarness,
  emit,
  enterDecision,
  preStepPayload,
  userMessage,
  type Harness,
} from "./helpers/harness.js";

let harness: Harness | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The OpenViking session id the runtime derives from a DSH session id. */
function ovId(dshSessionId: string): string {
  return `dsh-${dshSessionId}`;
}

/** One OpenViking session path, e.g. `/api/v1/sessions/dsh-x/commit`. */
function ovPath(ovSessionId: string, suffix = ""): string {
  return `/api/v1/sessions/${ovSessionId}${suffix}`;
}

type FetchHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** The same well-formed answers the shared harness stubs by default. */
const SUCCESS_BODIES: Record<string, unknown> = {
  "/health": {},
  "/api/v1/sessions": {},
  "/api/v1/system/status": { user: "default" },
  "/api/v1/fs/ls": [],
  "/api/v1/content/read": "",
  "/api/v1/search/search": { rendered: "", entries: [], digest: "", stats: {} },
  "/api/v1/search/find": { memories: [], resources: [], skills: [] },
  "/api/v1/search/recall": { rendered: "" },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ok(result: unknown = {}): Response {
  return json({ status: "ok", result }, 200);
}

/** The envelope the client turns into `{ ok: false, status }`. */
function failure(status: number, code = "FAILED"): Response {
  return json({ status: "error", error: { code, message: `HTTP ${status}` } }, status);
}

/**
 * A transport that answers the plugin's ordinary endpoints and lets one test
 * replace individual pathnames with a failure or with a gated response.
 */
function transport(
  overrides: Record<string, FetchHandler> = {},
): (path: string, init: RequestInit | undefined) => Promise<Response> {
  return async (path, init) => {
    const override = overrides[path];
    if (override) return await override(init);
    if (Object.hasOwn(SUCCESS_BODIES, path)) return ok(SUCCESS_BODIES[path]);
    return failure(404, "NOT_FOUND");
  };
}

/** The `.json` entries currently queued under `OPENVIKING_PENDING_DIR`. */
async function pendingFiles(): Promise<string[]> {
  const dir = process.env.OPENVIKING_PENDING_DIR;
  if (!dir) throw new Error("OPENVIKING_PENDING_DIR is not set");
  return (await readdir(dir)).filter(name => name.endsWith(".json"));
}

function captureEvent(text: string): { type: string; time: number; data: unknown } {
  return { type: "user/message", time: Date.now(), data: userMessage(text) };
}

describe("capture and the pending queue", () => {
  it("queues a retryable capture failure but drops a permanent client error", async () => {
    for (const [status, expected] of [[503, 1], [400, 0]] as const) {
      const sessionId = `dsh-capture-${status}`;
      const messages = ovPath(ovId(sessionId), "/messages");
      const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
      const local = await createHarness({}, {
        fetchImpl: transport({ [messages]: () => failure(status) }),
      });

      await emit(local, "session/event", session, captureEvent(`Remember the HTTP ${status} behaviour.`));
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
    for (const [status, expected] of [[503, 1], [400, 0]] as const) {
      const sessionId = `dsh-init-${status}`;
      const ovSession = ovId(sessionId);
      const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
      const local = await createHarness({}, {
        fetchImpl: transport({
          // The session-ensure call fails; the message itself would succeed, so
          // a stale `hasPendingWrites` latch is the only way this test passes
          // when the initialization failure should have been dropped.
          "/api/v1/sessions": () => failure(status),
          [ovPath(ovSession, "/messages")]: () => ok({}),
        }),
      });

      await emit(local, "session/event", session, captureEvent(`Remember the init ${status} behaviour.`));
      await emit(local, "session/flush", session);

      expect(await pendingFiles(), `HTTP ${status}`).toHaveLength(expected);
      expect(local.requestsFor(ovPath(ovSession, "/messages")), `HTTP ${status}`).toHaveLength(0);

      await local.dispose();
    }
  });

  it("queues a retryable threshold commit failure", async () => {
    const sessionId = "dsh-commit-fail";
    const ovSession = ovId(sessionId);
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    harness = await createHarness({}, {
      fetchImpl: transport({
        [ovPath(ovSession)]: () => ok({ pending_tokens: 50000 }),
        [ovPath(ovSession, "/commit")]: () => failure(503, "UNAVAILABLE"),
      }),
    });

    await emit(harness, "session/event", session, { type: "turn/end", time: Date.now(), data: {} });
    await emit(harness, "session/flush", session);

    expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
    const pending = await listPending();
    expect(pending.map(item => item.entry.type)).toEqual(["commitSession"]);
    expect(pending[0]!.entry.payload).toEqual({ keep_recent_count: 10 });
  });

  it("keeps queued messages and the final commit ordered on disk", async () => {
    const sessionId = "dsh-order";
    const ovSession = ovId(sessionId);
    const messages = ovPath(ovSession, "/messages");
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    harness = await createHarness({}, { fetchImpl: transport({ [messages]: () => failure(503) }) });

    await emit(harness, "session/event", session, captureEvent("First queued message."));
    await emit(harness, "session/flush", session);
    await emit(harness, "session/event", session, captureEvent("Second queued message."));
    await emit(harness, "session/flush", session);

    // The latch holds after the first failure: the second turn never hits the wire.
    expect(harness.requestsFor(messages)).toHaveLength(1);
    let pending = await listPending();
    expect(pending.map(item => item.entry.type)).toEqual(["addMessage", "addMessage"]);
    const createdAt = pending.map(item => item.entry.createdAt);
    // Strictly increasing, not merely non-decreasing: a tie would make the
    // queue's readdir order, not `createdAt`, decide the replay order.
    expect(createdAt[1]!).toBeGreaterThan(createdAt[0]!);
    expect(createdAt).toEqual([...createdAt].sort((left, right) => left - right));

    // A turn/end while the latch holds neither reads the session nor commits.
    await emit(harness, "session/event", session, { type: "turn/end", time: Date.now(), data: {} });
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
    expect((await listPending()).map(item => item.entry.type)).toEqual([
      "addMessage",
      "addMessage",
      "commitSession",
    ]);

    await emit(harness, "session/event", session, captureEvent("Third queued message."));
    await emit(harness, "session/flush", session);
    pending = await listPending();
    expect(pending.map(item => item.entry.type)).toEqual([
      "addMessage",
      "addMessage",
      "addMessage",
    ]);
    expect(
      pending.map(item => (item.entry.payload as { parts?: { text?: string }[] }).parts?.[0]?.text),
    ).toEqual(["First queued message.", "Second queued message.", "Third queued message."]);
    const afterSupersede = pending.map(item => item.entry.createdAt);
    expect(afterSupersede).toEqual([...afterSupersede].sort((left, right) => left - right));
  });
});

describe("commit threshold", () => {
  it("commits only past the threshold and records the server trace id", async () => {
    let pendingTokens = 5;
    const sessionId = "dsh-threshold";
    const ovSession = ovId(sessionId);
    const session = createFakeSession(sessionId, { cwd: "/workspace/project" });
    const records: PluginLogRecord[] = [];
    const unsubscribe = subscribePluginLogRecords(record => records.push(record));

    try {
      harness = await createHarness({ commitTokenThreshold: 20000 }, {
        fetchImpl: transport({
          [ovPath(ovSession)]: () => ok({ pending_tokens: pendingTokens }),
          [ovPath(ovSession, "/commit")]: () => ok({ trace_id: "trace-server-1" }),
        }),
      });

      await emit(harness, "session/event", session, { type: "turn/end", time: Date.now(), data: {} });
      await emit(harness, "session/flush", session);
      expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(0);
      expect(records.filter(record => record.event === "commit")).toHaveLength(0);

      pendingTokens = 50000;
      await emit(harness, "session/event", session, { type: "turn/end", time: Date.now(), data: {} });
      await emit(harness, "session/flush", session);

      expect(harness.requestsFor(ovPath(ovSession, "/commit"))).toHaveLength(1);
      const commits = records.filter(record => record.event === "commit");
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

describe("flush", () => {
  it("waits only for the session it was asked about", async () => {
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    let secondStarted!: () => void;
    const secondReachedTheGate = new Promise<void>(resolve => {
      secondStarted = resolve;
    });

    const first = createFakeSession("first", { cwd: "/workspace/first" });
    const second = createFakeSession("second", { cwd: "/workspace/second" });
    harness = await createHarness({}, {
      fetchImpl: transport({
        // Gate the second session's initialization, i.e. before any of its own
        // writes can reach the wire. The shared ensure-session endpoint tells
        // the two sessions apart by the id in its body.
        "/api/v1/sessions": async init => {
          const body = init?.body === undefined ? "" : String(init.body);
          if (body.includes(ovId("second"))) {
            secondStarted();
            await secondGate;
          }
          return ok({});
        },
      }),
    });

    await emit(harness, "session/event", first, captureEvent("A fact for the first session."));
    await emit(harness, "session/event", second, captureEvent("A fact for the second session."));
    await secondReachedTheGate;

    await emit(harness, "session/flush", first);
    expect(harness.requestsFor(ovPath(ovId("first"), "/messages"))).toHaveLength(1);
    expect(harness.requestsFor(ovPath(ovId("second"), "/messages"))).toHaveLength(0);

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
    expect(harness.requestsFor(ovPath(ovId("second"), "/messages"))).toHaveLength(1);
  });
});

describe("dispose", () => {
  it("drains the final commit before deleting the session state, and is safe twice", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>(resolve => {
      releaseCommit = resolve;
    });
    let commitStarted!: () => void;
    const commitInFlight = new Promise<void>(resolve => {
      commitStarted = resolve;
    });

    const ovSession = ovId("dispose");
    harness = await createHarness({}, {
      fetchImpl: transport({
        [ovPath(ovSession, "/commit")]: async () => {
          commitStarted();
          await commitGate;
          return ok({ trace_id: "shutdown" });
        },
      }),
    });
    const fake = createFakeAgent({ sessionId: "dispose", cwd: "/workspace/dispose" });

    await emit(harness, "agent/session-start", { agent: fake.agent, source: "startup" });
    await emit(harness, "session/event", fake.agent.session, captureEvent("A turn worth remembering."));
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

    await emit(harness, "session/event", one, captureEvent("First session turn."));
    await emit(harness, "session/event", two, captureEvent("Second session turn."));
    await emit(harness, "session/flush", one);
    await emit(harness, "session/flush", two);
    expect(harness.plugin.runtime.liveSessions).toBe(2);

    const lifecycle = harness.disposers.find(entry => entry.name.endsWith(".lifecycle"));
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

    const fake = createFakeAgent({ sessionId: "dsh-sync-off", cwd: "/workspace/off" });
    await emit(harness, "agent/session-start", { agent: fake.agent, source: "startup" });
    await emit(harness, "session/event", fake.agent.session, captureEvent("Never sent."));
    await emit(harness, "session/event", fake.agent.session, { type: "turn/end", time: Date.now(), data: {} });
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
    expect(pending.map(item => item.entry.sessionId)).toEqual(["dsh-earlier"]);
    expect(pending[0]!.entry.retries).toBe(0);
  });
});

describe("workspace peer", () => {
  it("sends the legacy cwd peer for peerSource: cwd and no peer for peerSource: none", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ov-peer-"));
    tempDirs.push(cwd);

    /** Capture one turn and report the headers that reached the wire. */
    const headersForSession = async (
      sessionId: string,
      config: Config,
    ): Promise<Record<string, string>> => {
      const messages = ovPath(ovId(sessionId), "/messages");
      const seen: Record<string, string>[] = [];
      const local = await createHarness(config, {
        fetchImpl: transport({
          [messages]: init => {
            seen.push((init?.headers ?? {}) as Record<string, string>);
            return ok({});
          },
        }),
      });

      const session = createFakeSession(sessionId, { cwd });
      await emit(local, "session/event", session, captureEvent("A workspace-scoped fact."));
      await emit(local, "session/flush", session);

      expect(local.requestsFor(messages)).toHaveLength(1);
      await local.dispose();
      return seen[0]!;
    };

    const byCwd = await headersForSession("dsh-peer-cwd", { peerSource: "cwd", workspacePeer: true });
    // The legacy rule: one byte in, one byte out, no collapsing and no trimming.
    expect(byCwd["X-OpenViking-Actor-Peer"]).toBe(cwd.replace(/[^A-Za-z0-9]/g, "-"));

    const disabled = await headersForSession("dsh-peer-none", { peerSource: "none", workspacePeer: true });
    expect("X-OpenViking-Actor-Peer" in disabled).toBe(false);
  });
});

describe("startup profile injection", () => {
  const PROFILE = "## Profile\n- prefers terse answers and no emojis";

  function priorStartupProfile(): unknown {
    return createUserMessage({
      content: [{ type: "text", text: "stored profile" }],
      source: { kind: "plugin", plugin: "openviking-memory", form: "instructions" },
    });
  }

  it("claims the profile once while idle and leaves it to pre-step after a turn starts", async () => {
    harness = await createHarness({}, {
      fetchImpl: transport({ "/api/v1/content/read": () => ok(PROFILE) }),
    });

    const idle = createFakeAgent({ sessionId: "profile-idle", cwd: "/workspace/project", ownEvents: [] });
    await emit(harness, "agent/session-start", { agent: idle.agent, source: "startup" });
    expect(idle.injected).toHaveLength(1);
    expect(idle.injected[0]!.source).toMatchObject({
      kind: "plugin",
      plugin: "openviking-memory",
      form: "instructions",
    });

    // The claim is one-shot: the next step adds the profile a second time only
    // if delivery had not already happened.
    const messages = [userMessage("what did we decide about the recall budget last time?")];
    const decision = await emit(
      harness,
      "agent/pre-step",
      preStepPayload(idle.agent, messages),
      async () => enterDecision(messages),
    );
    expect(decision).toEqual(enterDecision(messages));

    const running = createFakeAgent({
      sessionId: "profile-running",
      cwd: "/workspace/project",
      status: "running",
      ownEvents: [],
    });
    await emit(harness, "agent/session-start", { agent: running.agent, source: "startup" });
    expect(running.injected).toEqual([]);

    const resumed = createFakeAgent({
      sessionId: "profile-resumed",
      cwd: "/workspace/project",
      ownEvents: [{ type: "user/message", data: priorStartupProfile() }],
    });
    await emit(harness, "agent/session-start", { agent: resumed.agent, source: "startup" });
    expect(resumed.injected).toEqual([]);
  });
});
