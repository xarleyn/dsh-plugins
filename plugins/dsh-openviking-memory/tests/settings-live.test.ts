/**
 * The plugin's live configuration.
 *
 * Since 0.1.7 a plugin does not register a settings section: every knob of
 * `static Config` is a volatile field, the Cordis profile entry id *is* the
 * settings namespace, and the Host keeps the references current as the document
 * changes. What this file therefore asserts is not a registration but the two
 * halves of that contract — the schema declares the knobs the card may edit, and
 * a committed edit reaches a session that is already running.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFakeAgent,
  createHarness,
  emit,
  enterDecision,
  preStepPayload,
  userMessage,
  type Harness,
} from "./helpers/harness.js";
import { Config as ConfigSchema } from "../src/config.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Drive one step that reaches `enter`, and report how many recalls it made. */
async function stepRecalls(
  target: Harness,
  sessionId: string,
): Promise<number> {
  const { agent } = createFakeAgent({ sessionId });
  await emit(target, "agent/created", { agent, source: "startup" });
  const payload = preStepPayload(agent, [
    userMessage("what did we decide about the release plan?"),
  ]);
  const before = target.countRequests("/api/v1/search/search");
  await emit(target, "agent/pre-step", payload, () =>
    Promise.resolve(enterDecision(payload.messages)),
  );
  return target.countRequests("/api/v1/search/search") - before;
}

/** Automatic context requests — profile reads and recall searches — issued from `start` on. */
function automaticContextRequests(target: Harness, start = 0): number {
  return target.requests
    .slice(start)
    .filter(
      (request) =>
        request.path === "/api/v1/search/search" ||
        request.search.includes("profile.md"),
    ).length;
}

describe("the namespace a card edits", () => {
  it("marks every knob volatile, which is what publishes the namespace", () => {
    // A namespace with no volatile field is absent from the Host's `describe()`
    // view, and the browser form for it is `undefined` — a card that shows
    // nothing. Volatility is the registration now, so it has to be complete:
    // every field the card can write must carry it.
    const schema = ConfigSchema as unknown as {
      dict: Record<string, { meta?: { volatile?: boolean } }>;
    };
    const plain = Object.entries(schema.dict)
      .filter(([, node]) => node.meta?.volatile !== true)
      .map(([key]) => key);

    expect(plain).toEqual([]);
  });

  it("keys the namespace by the profile entry id", async () => {
    harness = await createHarness();

    // The browser binds `ctx.configForms.get(ns)` and the page joins a row on
    // `<package name>#<row id>`; both only meet if the namespace is the entry id.
    expect(harness.plugin.status()).toMatchObject({
      endpoint: "http://127.0.0.1:1933",
    });
  });

  it("turns the Host's generated page off, because it ships its own card", async () => {
    const asks: { auto?: boolean }[] = [];
    harness = await createHarness(
      {},
      {
        settings: {
          configure: (presentation) => {
            asks.push(presentation);
            return () => undefined;
          },
        },
      },
    );

    // Volatile fields publish a namespace, and a namespace with no policy gets
    // an auto-generated form page — a second editor of the same document, next
    // to the card. The plugin asks for that page off. (The harness runs an
    // effect body twice — once for the effect, once to capture its disposer — so
    // the assertion is about the policy asked, not about a call count.)
    await vi.waitFor(() => {
      expect(asks.length).toBeGreaterThan(0);
    });
    for (const ask of asks) expect(ask).toEqual({ auto: false });
  });

  it("starts on the composition entry it was mounted with", async () => {
    harness = await createHarness({
      endpoint: "http://memory.example:1933",
      autoInject: false,
    });

    expect(harness.plugin.entryConfig).toMatchObject({
      endpoint: "http://memory.example:1933",
      autoInject: false,
    });
    expect(harness.plugin.resolved.endpoint).toBe("http://memory.example:1933");
    expect(harness.plugin.injection.startupProfile).toBe(false);
  });
});

describe("a committed change reaches a running session", () => {
  it("switches one knob off without a restart", async () => {
    harness = await createHarness();
    expect(await stepRecalls(harness, "dsh-session-1")).toBeGreaterThan(0);

    // The operator switches automatic recall off in the card; the Host moves the
    // reference, and the next session the plugin looks at reads the new value.
    harness.writeConfig({ autoRecall: false });

    expect(await stepRecalls(harness, "dsh-session-2")).toBe(0);
    expect(harness.plugin.injection.recall).toBe(false);
  });

  it("switches the master switch off for a session that is already running", async () => {
    harness = await createHarness();
    const { agent } = createFakeAgent({ sessionId: "dsh-session-1" });
    await emit(harness, "agent/created", { agent, source: "startup" });
    expect(automaticContextRequests(harness)).toBeGreaterThan(0);

    harness.writeConfig({ autoInject: false });

    // The next step of the session that was already open is where the plugin
    // re-reads its configuration — and it issues nothing.
    const before = harness.requests.length;
    const payload = preStepPayload(agent, [
      userMessage("what did we decide about the release plan?"),
    ]);
    await emit(harness, "agent/pre-step", payload, () =>
      Promise.resolve(enterDecision(payload.messages)),
    );
    expect(harness.plugin.injection).toEqual({
      startupProfile: false,
      stepProfile: false,
      recall: false,
    });
    expect(harness.requests.length).toBe(before);
    expect(automaticContextRequests(harness, before)).toBe(0);

    // Off means off for automatic context only: the conversation is still
    // captured, so the switch does not quietly disable the memory itself.
    await emit(harness, "session/event", agent.session, {
      type: "user/message",
      time: Date.now(),
      data: userMessage("the release step is gated on the smoke suite"),
    });
    await emit(harness, "session/flush", agent.session);
    const captured = harness.requests
      .slice(before)
      .filter((request) => request.path.startsWith("/api/v1/sessions/"));
    expect(captured.length).toBeGreaterThan(0);
  });

  it("moves a session that is already open onto its account space", async () => {
    const owners: Record<string, string> = { "dsh-session-1": "account-a" };
    harness = await createHarness(
      { qaUserScoping: false, user: "shared-account" },
      {
        qaSurface: {
          principalForSession: (sessionId) => {
            const userId = owners[sessionId];
            return userId === undefined ? undefined : { userId };
          },
          principalForToken: () => undefined,
        },
      },
    );

    const { agent } = createFakeAgent({ sessionId: "dsh-session-1" });
    await emit(harness, "agent/created", { agent, source: "startup" });
    for (const request of harness.requests) {
      expect(request.headers["X-OpenViking-User"]).toBe("shared-account");
    }

    // The operator flips the card's Multi-user memory switch.
    harness.writeConfig({ qaUserScoping: true });

    const payload = preStepPayload(agent, [
      userMessage("what did we decide about the release plan?"),
    ]);
    await emit(harness, "agent/pre-step", payload, () =>
      Promise.resolve(enterDecision(payload.messages)),
    );

    // The switch reaches the session that was open before it was flipped: the
    // option is read per request, so no chat keeps the old space.
    const recalls = harness.requestsFor("/api/v1/search/search");
    expect(recalls.length).toBeGreaterThan(0);
    for (const request of recalls) {
      expect(request.headers["X-OpenViking-User"]).toBe("account-a");
    }
  });

  it("re-reads the endpoint of a session that is already running", async () => {
    harness = await createHarness();
    const { agent } = createFakeAgent({ sessionId: "dsh-session-1" });
    await emit(harness, "agent/created", { agent, source: "startup" });

    harness.writeConfig({ endpoint: "http://elsewhere.example" });

    const payload = preStepPayload(agent, [
      userMessage("what did we decide about the release plan?"),
    ]);
    await emit(harness, "agent/pre-step", payload, () =>
      Promise.resolve(enterDecision(payload.messages)),
    );

    // The chat that was open before the edit resolves against the server the
    // card names now, and the runtime was handed that configuration.
    expect(harness.plugin.resolved.endpoint).toBe("http://elsewhere.example");
    expect(harness.plugin.status().endpoint).toBe("http://elsewhere.example");
  });

  it("goes back to the composition entry when the override is cleared", async () => {
    harness = await createHarness({
      endpoint: "http://memory.example:1933",
      autoInject: false,
    });

    // An edit lands above the composition layer, then the user clears it. The
    // plugin re-reads on the operation that follows either change.
    harness.writeConfig({ endpoint: "http://elsewhere.example" });
    await stepRecalls(harness, "dsh-session-1");
    expect(harness.plugin.resolved.endpoint).toBe("http://elsewhere.example");

    harness.writeConfig({ endpoint: undefined });
    await stepRecalls(harness, "dsh-session-2");
    expect(harness.plugin.resolved.endpoint).toBe("http://memory.example:1933");
    expect(harness.plugin.injection.startupProfile).toBe(false);
  });
});
