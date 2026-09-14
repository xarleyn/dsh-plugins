/**
 * The fork's central guarantee (SPEC §9-§13, §22.2-§22.3, §35): the four
 * injection controls decide whether automatic context is presented, and when a
 * capability is off no request is issued for it — not "a request whose result
 * is discarded".
 *
 * Every assertion here is made against the recorded transport, because that is
 * the only place the difference between "disabled" and "computed then dropped"
 * is observable.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeAgent,
  createHarness,
  emit,
  enterDecision,
  preStepPayload,
  userMessage,
  type Harness,
} from "./helpers/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Requests that read `memories/profile.md` — only the profile path does. */
function profileReads(target: Harness): number {
  return target.requests.filter(
    (request) =>
      request.path === "/api/v1/content/read" &&
      request.search.includes("profile.md"),
  ).length;
}

/** Requests that touch the server-assembled context face (automatic recall). */
function recallSearches(target: Harness): number {
  return target.countRequests("/api/v1/search/search");
}

/** The OpenViking session id the runtime derives from a DSH session id. */
function ovSessionId(dshSessionId: string): string {
  return `dsh-${dshSessionId}`;
}

interface PhaseReport {
  /** Profile reads issued by `agent/session-start`. */
  readonly startupProfile: number;
  /** Recall searches issued by `agent/pre-step`. */
  readonly stepRecall: number;
  /** Profile reads issued anywhere in the session. */
  readonly totalProfile: number;
}

/**
 * Drive one session through `agent/session-start` and a single `pre-step`,
 * reporting what each phase issued.
 *
 * The profile is built once per session, during runtime initialization, so the
 * observable effect of `injectStartupProfile` is that initialization (and the
 * profile read) happens at session start; with it off, the first step triggers
 * it instead. `injectStepProfile: false` is observable as the absence of that
 * fallback.
 */
async function runSession(
  target: Harness,
  options: { readonly cwd?: string } = {},
): Promise<PhaseReport> {
  const fake = createFakeAgent({
    sessionId: "dsh-inject",
    cwd: options.cwd ?? "/workspace/project",
  });

  await emit(target, "agent/session-start", {
    agent: fake.agent,
    source: "startup",
  });
  const startupProfile = profileReads(target);

  const messages = [
    userMessage("what did we decide about the recall budget last time?"),
  ];
  await emit(
    target,
    "agent/pre-step",
    preStepPayload(fake.agent, messages),
    async () => enterDecision(messages),
  );

  return {
    startupProfile,
    stepRecall: recallSearches(target),
    totalProfile: profileReads(target),
  };
}

describe("automatic injection matrix (SPEC §22.2)", () => {
  it("defaults to upstream-compatible behaviour: profile at startup, recall per step", async () => {
    harness = await createHarness({ endpoint: "http://127.0.0.1:1933" });
    const result = await runSession(harness);

    expect(result.startupProfile).toBeGreaterThan(0);
    expect(result.stepRecall).toBeGreaterThan(0);
    expect(harness.plugin.injection).toEqual({
      startupProfile: true,
      stepProfile: true,
      recall: true,
    });
  });

  it("autoInject:false issues no profile and no recall work at all", async () => {
    harness = await createHarness({ autoInject: false });
    const result = await runSession(harness);

    expect(result).toEqual({
      startupProfile: 0,
      stepRecall: 0,
      totalProfile: 0,
    });
    expect(harness.requests).toEqual([]);
  });

  it("injectStartupProfile:false defers the profile read to the step, which still delivers it", async () => {
    harness = await createHarness({ injectStartupProfile: false });
    const result = await runSession(harness);

    expect(result.startupProfile).toBe(0);
    expect(result.totalProfile).toBeGreaterThan(0);
    expect(result.stepRecall).toBeGreaterThan(0);
  });

  it("injectStepProfile:false removes the per-step profile fallback entirely", async () => {
    harness = await createHarness({
      injectStartupProfile: false,
      injectStepProfile: false,
    });
    const result = await runSession(harness);

    expect(result.startupProfile).toBe(0);
    expect(result.totalProfile).toBe(0);
    expect(result.stepRecall).toBeGreaterThan(0);
  });

  it("autoRecall:false keeps recall out while the profile path still runs", async () => {
    harness = await createHarness({ autoRecall: false });
    const result = await runSession(harness);

    expect(result.startupProfile).toBeGreaterThan(0);
    expect(result.stepRecall).toBe(0);
    expect(recallSearches(harness)).toBe(0);
  });

  it("all granular knobs false behave exactly like autoInject:false", async () => {
    harness = await createHarness({
      injectStartupProfile: false,
      injectStepProfile: false,
      autoRecall: false,
    });
    const result = await runSession(harness);

    expect(result).toEqual({
      startupProfile: 0,
      stepRecall: 0,
      totalProfile: 0,
    });
    expect(harness.requests).toEqual([]);
  });

  it("supports a mixed configuration: profile at startup only, no recall", async () => {
    harness = await createHarness({
      autoInject: true,
      injectStartupProfile: true,
      injectStepProfile: false,
      autoRecall: false,
    });
    const result = await runSession(harness);

    expect(result.startupProfile).toBeGreaterThan(0);
    expect(result.stepRecall).toBe(0);
    expect(recallSearches(harness)).toBe(0);
  });
});

describe("manual-only mode (SPEC §11, §22.3)", () => {
  it("disables every automatic injection while capture, commit, tools, skills and the guard stay live", async () => {
    harness = await createHarness({ autoInject: false, syncTurns: true });
    const fake = createFakeAgent({
      sessionId: "dsh-manual",
      cwd: "/workspace/project",
    });

    await emit(harness, "agent/session-start", {
      agent: fake.agent,
      source: "startup",
    });

    const before = harness.requests.length;
    const messages = [
      userMessage("please remember the deploy checklist for release day"),
    ];
    await emit(
      harness,
      "agent/pre-step",
      preStepPayload(fake.agent, messages),
      async () => enterDecision(messages),
    );

    // Zero automatic work: the step added no transport activity of its own.
    expect(harness.requests.length).toBe(before);
    expect(profileReads(harness)).toBe(0);
    expect(recallSearches(harness)).toBe(0);

    // Capture and commit still work through the same runtime.
    await emit(harness, "session/event", fake.agent.session, {
      type: "user/message",
      time: Date.now(),
      data: userMessage("the release step is gated on the smoke suite"),
    });
    await emit(harness, "session/event", fake.agent.session, {
      type: "turn/end",
      data: {},
    });
    await emit(harness, "session/flush", fake.agent.session);

    const ovId = ovSessionId(fake.agent.session.id);
    expect(
      harness.requestsFor(`/api/v1/sessions/${ovId}/messages`).length,
    ).toBeGreaterThan(0);
    expect(harness.countRequests("/api/v1/sessions/")).toBeGreaterThan(0);

    // Both surfaces are mounted regardless of the injection controls.
    expect(harness.mounted).toHaveLength(2);
    expect(
      harness.mounted.some(
        (entry) =>
          (entry.config as { providerName?: string }).providerName ===
          "openviking",
      ),
    ).toBe(true);
    expect(
      harness.mounted.some(
        (entry) =>
          (entry.config as { serverName?: string }).serverName === "openviking",
      ),
    ).toBe(true);

    // The URI guard is registered and still denies.
    expect(harness.listeners.has("tools/pre-execute")).toBe(true);
  });

  it("stays silent when both injection and capture are off", async () => {
    harness = await createHarness({ autoInject: false, syncTurns: false });
    const fake = createFakeAgent({ sessionId: "dsh-silent" });

    await emit(harness, "agent/session-start", {
      agent: fake.agent,
      source: "startup",
    });
    await emit(harness, "session/event", fake.agent.session, {
      type: "user/message",
      time: Date.now(),
      data: userMessage("a durable fact worth remembering"),
    });
    await emit(harness, "session/event", fake.agent.session, {
      type: "turn/end",
      data: {},
    });
    await emit(harness, "session/flush", fake.agent.session);

    expect(harness.requests).toEqual([]);
  });
});

describe("injection controls never reach into capture", () => {
  it("defaults keep capturing while automatic context is on", async () => {
    harness = await createHarness({});
    const fake = createFakeAgent({ sessionId: "dsh-capture" });

    await emit(harness, "session/event", fake.agent.session, {
      type: "user/message",
      time: Date.now(),
      data: userMessage("the retry policy lives in settings.yaml"),
    });
    await emit(harness, "session/flush", fake.agent.session);

    expect(
      harness.requestsFor(
        `/api/v1/sessions/${ovSessionId(fake.agent.session.id)}/messages`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("skipSubagentSessions keeps a delegated session out of every path", async () => {
    harness = await createHarness({ skipSubagentSessions: true });
    const fake = createFakeAgent({
      sessionId: "dsh-child",
      origin: "subagent",
    });

    await emit(harness, "agent/session-start", {
      agent: fake.agent,
      source: "startup",
    });
    const messages = [
      userMessage("delegated exploration chatter about memory budgets"),
    ];
    const decision = await emit(
      harness,
      "agent/pre-step",
      preStepPayload(fake.agent, messages),
      async () => enterDecision(messages),
    );
    await emit(harness, "session/event", fake.agent.session, {
      type: "user/message",
      time: Date.now(),
      data: userMessage("more delegated chatter"),
    });
    await emit(harness, "session/flush", fake.agent.session);

    expect(decision).toEqual(enterDecision(messages));
    expect(harness.requests).toEqual([]);
    expect(harness.plugin.runtime.liveSessions).toBe(0);
  });
});
