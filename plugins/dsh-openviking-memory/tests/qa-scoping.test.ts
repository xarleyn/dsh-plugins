/**
 * Per-account memory on a QA deployment (the fork's separation guarantee).
 *
 * Two things have to hold on the wire, and both are only observable at the
 * transport layer:
 *
 *   1. every request a session issues carries the header of the account that
 *      owns that session, so two chats never share a memory space;
 *   2. a session no account has claimed yet issues *no* request at all — not a
 *      request whose result is discarded — because a conversation must never
 *      read from, or write into, a space it does not belong to.
 *
 * Without a QA surface the plugin keeps one deployment-wide identity, which is
 * what these tests pin as the unchanged default.
 */

import { writeFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

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

/** Every `X-OpenViking-User` value one path received, in request order. */
function usersOn(target: Harness, path: string): (string | undefined)[] {
  return target
    .requestsFor(path)
    .map((request) => request.headers["X-OpenViking-User"]);
}

/** Drive one turn: session start, then a single step that reaches `enter`. */
async function runTurn(
  target: Harness,
  sessionId: string,
  text = "what did we decide about the release plan?",
): Promise<void> {
  const { agent } = createFakeAgent({ sessionId });
  await emit(target, "agent/session-start", { agent });
  const payload = preStepPayload(agent, [userMessage(text)]);
  await emit(target, "agent/pre-step", payload, () =>
    Promise.resolve(enterDecision(payload.messages)),
  );
}

describe("per-account scoping", () => {
  it("sends the header of the account that owns the session", async () => {
    harness = await createHarness(
      {},
      { qaSurface: surfaceFor({ "dsh-session-1": "account-a" }) },
    );

    await runTurn(harness, "dsh-session-1");

    expect(harness.requests.length).toBeGreaterThan(0);
    for (const request of harness.requests) {
      expect(request.headers["X-OpenViking-User"]).toBe("account-a");
    }
  });

  it("keeps two accounts' requests apart", async () => {
    harness = await createHarness(
      {},
      {
        qaSurface: surfaceFor({
          "dsh-session-1": "account-a",
          "dsh-session-2": "account-b",
        }),
      },
    );

    await runTurn(harness, "dsh-session-1");
    await runTurn(harness, "dsh-session-2");

    const users = new Set(
      harness.requests.map((request) => request.headers["X-OpenViking-User"]),
    );
    expect(users).toEqual(new Set(["account-a", "account-b"]));
  });

  it("issues nothing at all for a session no account has claimed", async () => {
    harness = await createHarness({}, { qaSurface: surfaceFor({}) });

    await runTurn(harness, "dsh-session-1");
    await emit(harness, "session/event", createFakeSession("dsh-session-1"), {
      type: "turn/end",
    });

    expect(harness.requests).toEqual([]);
  });

  it("leaves a child session in the account that started the chat", async () => {
    harness = await createHarness(
      {},
      {
        qaSurface: surfaceFor({ "dsh-root": "account-a" }),
      },
    );

    const child = createFakeSession("dsh-child", { parentSession: "dsh-root" });
    await emit(harness, "session/created", child);
    await emit(harness, "session/event", child, { type: "turn/end" });

    expect(harness.requests.length).toBeGreaterThan(0);
    for (const request of harness.requests) {
      expect(request.headers["X-OpenViking-User"]).toBe("account-a");
    }
  });

  it("keeps the deployment-wide identity when the option is off", async () => {
    harness = await createHarness(
      { qaUserScoping: false, user: "shared-account" },
      { qaSurface: surfaceFor({}) },
    );

    await runTurn(harness, "dsh-session-1");

    expect(usersOn(harness, "/api/v1/search/search")).toEqual([
      "shared-account",
    ]);
  });

  it("keeps the deployment-wide identity without a QA surface", async () => {
    harness = await createHarness({ user: "shared-account" });

    await runTurn(harness, "dsh-session-1");

    expect(usersOn(harness, "/api/v1/search/search")).toEqual([
      "shared-account",
    ]);
  });
});

describe("per-account switches", () => {
  /** One account with automatic context switched off for it. */
  function seedRecallOff(target: Harness, userId: string): void {
    writeFileSync(
      target.settingsPath,
      `${JSON.stringify({ version: 1, users: { [userId]: { recall: false } } })}\n`,
      "utf-8",
    );
  }

  it("issues no recall for the account that switched it off", async () => {
    harness = await createHarness(
      {},
      {
        qaSurface: surfaceFor({
          "dsh-session-1": "account-a",
          "dsh-session-2": "account-b",
        }),
      },
    );
    seedRecallOff(harness, "account-a");

    await runTurn(harness, "dsh-session-2");
    const withRecall = harness.countRequests("/api/v1/search/search");
    expect(withRecall).toBeGreaterThan(0);

    await runTurn(harness, "dsh-session-1");
    expect(harness.countRequests("/api/v1/search/search")).toBe(withRecall);
  });

  it("issues no profile request for an account that switched the master switch off", async () => {
    harness = await createHarness(
      {},
      { qaSurface: surfaceFor({ "dsh-session-1": "account-a" }) },
    );
    writeFileSync(
      harness.settingsPath,
      `${JSON.stringify({
        version: 1,
        users: { "account-a": { autoInject: false } },
      })}\n`,
      "utf-8",
    );

    await runTurn(harness, "dsh-session-1");

    const profileReads = harness.requests.filter((request) =>
      request.search.includes("profile.md"),
    );
    expect(profileReads).toEqual([]);
  });
});
