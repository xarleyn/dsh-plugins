/**
 * The account-scoped memory Remote: the page authenticates with a token the
 * Host resolves to an account, and no method accepts an account id from the
 * caller. A refused token is the whole authorization story, so it is asserted
 * for the method.
 *
 * The reads themselves are asserted at the transport layer: the page has to ask
 * the store the same space the account's chats use, and it has to notice when
 * the store answers as somebody else.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "./helpers/harness.js";
import { json, ok, transport } from "./runtime.helpers.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Tokens are the only identity the browser supplies. */
const TOKENS = { "token-a": "account-a" };

async function harnessWithAccounts(
  options: Parameters<typeof createHarness>[1] = {},
): Promise<Harness> {
  return await createHarness(
    {},
    {
      ...options,
      qaSurface: {
        principalForSession: (sessionId) =>
          TOKENS[sessionId as keyof typeof TOKENS] === undefined
            ? undefined
            : { userId: TOKENS[sessionId as keyof typeof TOKENS] },
        principalForToken: (token) =>
          TOKENS[token as keyof typeof TOKENS] === undefined
            ? undefined
            : { userId: TOKENS[token as keyof typeof TOKENS] },
      },
    },
  );
}

/** The store's answers: one section with one entry, one profile, one chat. */
const MEMORIES = [
  {
    uri: "viking://user/account-a/memories/cases",
    rel_path: "cases",
    isDir: true,
    modTime: "2026-09-22T06:00:00.000Z",
    abstract: "Разобранные случаи.",
  },
  {
    uri: "viking://user/account-a/memories/cases/ftp.md",
    rel_path: "cases/ftp.md",
    isDir: false,
    modTime: "2026-09-22T06:05:00.000Z",
    abstract: "",
  },
  {
    uri: "viking://user/account-a/memories/identity.md",
    rel_path: "identity.md",
    isDir: false,
    modTime: "2026-09-22T06:05:00.000Z",
    abstract: "",
  },
  {
    uri: "viking://user/account-a/memories/soul.md",
    rel_path: "soul.md",
    isDir: false,
    modTime: "2026-09-22T06:05:00.000Z",
    abstract: "",
  },
];

/**
 * Conversations as the store answers them: directories under an absolute URI,
 * with no relative path to lean on.
 */
const SESSIONS = [
  {
    uri: "viking://user/account-a/sessions/dsh-aaa",
    isDir: true,
    modTime: "2026-09-22T06:29:01.000Z",
    abstract: "Настраивали FTP.",
  },
  {
    uri: "viking://user/account-a/sessions/cli__x",
    isDir: true,
    modTime: "2026-09-22T07:00:00.000Z",
    abstract: "Не разговор стенда.",
  },
];

/** A transport that answers by endpoint and by the URI being listed. */
function storeTransport(user: string) {
  return transport({
    "/api/v1/system/status": () => ok({ initialized: true, user }),
    "/api/v1/fs/ls": (_init, url) => {
      const uri = url?.searchParams.get("uri") ?? "";
      if (uri.endsWith("/sessions")) return ok(SESSIONS);
      if (uri.endsWith("/memories")) return ok(MEMORIES);
      return ok([]);
    },
    "/api/v1/content/read": () => ok("Ассистент отвечает по-русски.\n"),
  });
}

describe("account-scoped memory Remote", () => {
  it("reads the account's own space and reports what it holds", async () => {
    harness = await harnessWithAccounts({
      fetchImpl: storeTransport("account-a"),
    });

    const view = await harness.plugin.userMemoryOverview("token-a");

    expect(view.connected).toBe(true);
    expect(view.scoped).toBe(true);
    // The store answered as the account the plugin asked for.
    expect(view.accountApplies).toBe(true);
    expect(view.serverIdentity).toBe("account-a");
    expect(view.profile).toEqual({
      name: "identity.md",
      text: "Ассистент отвечает по-русски.",
      truncated: false,
    });
    expect(view.groups.map((group) => group.title)).toEqual(["Разборы"]);
    expect(view.groups[0]?.items.map((item) => item.name)).toEqual(["ftp"]);
    // The profile file is shown as text above, and the assistant's own persona
    // file is not a note about the account: neither is listed again.
    expect(
      view.groups.flatMap((group) => group.items.map((item) => item.name)),
    ).toEqual(["ftp"]);
    // Only the chats this plugin captures are conversations of the account.
    expect(view.sessions.map((session) => session.id)).toEqual(["aaa"]);
    expect(view.totals.sections).toBe(1);
    expect(view.totals.sessions).toBe(1);
  });

  it("asks the store as the signed-in account", async () => {
    harness = await harnessWithAccounts({
      fetchImpl: storeTransport("account-a"),
    });

    await harness.plugin.userMemoryOverview("token-a");

    const reads = harness.requests.filter(
      (request) => request.path === "/api/v1/system/status",
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0]?.headers["X-OpenViking-User"]).toBe("account-a");
  });

  it("does not return shared content when scoped identity does not match", async () => {
    harness = await harnessWithAccounts({
      fetchImpl: storeTransport("deepseek-harness"),
    });

    const view = await harness.plugin.userMemoryOverview("token-a");

    expect(view.connected).toBe(true);
    expect(view.accountApplies).toBe(false);
    expect(view.serverIdentity).toBe("deepseek-harness");
    expect(view.profile).toBeNull();
    expect(view.groups).toEqual([]);
    expect(view.sessions).toEqual([]);
    expect(harness.requests.map((request) => request.path)).toEqual([
      "/api/v1/system/status",
    ]);
  });

  it("reports an unscoped deployment", async () => {
    harness = await createHarness(
      { qaUserScoping: false },
      {
        fetchImpl: storeTransport("deepseek-harness"),
        qaSurface: {
          principalForSession: () => undefined,
          principalForToken: (token) =>
            token === "token-a" ? { userId: "account-a" } : undefined,
        },
      },
    );

    expect((await harness.plugin.userMemoryOverview("token-a")).scoped).toBe(
      false,
    );
  });

  it("reports a store that is down instead of throwing", async () => {
    harness = await harnessWithAccounts({
      fetchImpl: transport({
        "/api/v1/system/status": () =>
          json(
            { status: "error", error: { message: "connect ECONNREFUSED" } },
            503,
          ),
      }),
    });

    const view = await harness.plugin.userMemoryOverview("token-a");

    expect(view.connected).toBe(false);
    expect(view.error).toBe("connect ECONNREFUSED");
    expect(view.totals).toEqual({ sections: 0, memories: 0, sessions: 0 });
  });

  it("refuses the call for a token no account owns", async () => {
    harness = await harnessWithAccounts();

    await expect(harness.plugin.userMemoryOverview("nobody")).rejects.toThrow();
  });

  it("refuses the call when the deployment mounts no QA surface", async () => {
    harness = await createHarness({});

    await expect(
      harness.plugin.userMemoryOverview("token-a"),
    ).rejects.toThrow();
  });

  it("exposes no method that writes to the store", async () => {
    harness = await harnessWithAccounts();

    const surface = harness.plugin as unknown as Record<string, unknown>;
    expect(typeof surface.userMemoryOverview).toBe("function");
    expect(surface.setUserMemorySettings).toBeUndefined();
    expect(surface.resetUserMemorySettings).toBeUndefined();
  });
});
