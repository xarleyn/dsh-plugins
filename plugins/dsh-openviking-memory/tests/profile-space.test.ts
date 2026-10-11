/**
 * Whose user space a profile is read from.
 *
 * The space an account's memory lives in is resolved by asking the server, and
 * the answer is remembered — that is what keeps a session's three profile reads
 * down to one resolution. The remembering is the whole hazard: one process
 * serves every QA account and can be pointed at another server while it runs, so
 * a space resolved for one identity must never answer for another.
 *
 * The assertions are about the URIs on the wire, not the headers. A request can
 * carry the right `X-OpenViking-User` and still address somebody else's space,
 * because a wrong URI is not corrected by a correct header.
 */

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import {
  createFakeAgent,
  createHarness,
  emit,
  type Harness,
} from "./helpers/harness.js";
import { failure, ok } from "./runtime.helpers.js";

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

/**
 * A server that keeps one space per caller, the way a per-account deployment
 * does: whose name `/system/status` reports and what `viking://user` lists both
 * follow the `X-OpenViking-User` header. `spacesByHost` pins a host to a space
 * regardless of the caller, which is how a test moves an installation to a
 * server whose spaces have nothing in common with the old one.
 */
function spaceServer(
  options: { readonly spacesByHost?: Record<string, string> } = {},
) {
  return async (
    path: string,
    init: RequestInit | undefined,
    url?: URL,
  ): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const caller = headers["X-OpenViking-User"] ?? "";
    const space =
      options.spacesByHost?.[url?.host ?? ""] ?? (caller || "default");
    const uri = new URLSearchParams(url?.search ?? "").get("uri") ?? "";
    if (path === "/health" || path === "/api/v1/sessions") return ok({});
    if (path === "/api/v1/system/status") return ok({ user: space });
    if (path === "/api/v1/fs/ls") {
      // Only the space listing is worth answering; the memory-directory
      // listings come back empty, so a profile is the block's only content.
      return uri === "viking://user"
        ? ok([{ name: space, isDir: true }])
        : ok([]);
    }
    if (path === "/api/v1/content/read") return ok(`profile of ${uri}`);
    return failure(404, "NOT_FOUND");
  };
}

/** Start one agent, which is what reads its account's profile. */
async function startSession(target: Harness, sessionId: string): Promise<void> {
  const { agent } = createFakeAgent({ sessionId });
  await emit(target, "agent/created", { agent });
}

/** Every profile read issued: the account it was sent as and the URI it asked for. */
function profileReads(
  target: Harness,
): { readonly user: string; readonly uri: string }[] {
  return target.requestsFor("/api/v1/content/read").map((request) => ({
    user: request.headers["X-OpenViking-User"] ?? "",
    uri: new URLSearchParams(request.search).get("uri") ?? "",
  }));
}

describe("the profile's user space", () => {
  it("resolves each account's own space one after another", async () => {
    harness = await createHarness(
      { endpoint: "http://space-sequential.example" },
      {
        fetchImpl: spaceServer(),
        qaSurface: surfaceFor({
          "dsh-a": "account-a",
          "dsh-b": "account-b",
        }),
      },
    );

    await startSession(harness, "dsh-a");
    await startSession(harness, "dsh-b");

    expect(profileReads(harness)).toEqual([
      {
        user: "account-a",
        uri: "viking://user/account-a/memories/profile.md",
      },
      {
        user: "account-b",
        uri: "viking://user/account-b/memories/profile.md",
      },
    ]);
  });

  it("resolves each account's own space when the sessions start together", async () => {
    harness = await createHarness(
      { endpoint: "http://space-concurrent.example" },
      {
        fetchImpl: spaceServer(),
        qaSurface: surfaceFor({
          "dsh-a": "account-a",
          "dsh-b": "account-b",
        }),
      },
    );

    await Promise.all([
      startSession(harness, "dsh-a"),
      startSession(harness, "dsh-b"),
    ]);

    // Interleaving may reorder the two runs, so this reads as a pair of answers.
    expect(new Map(profileReads(harness).map((r) => [r.user, r.uri]))).toEqual(
      new Map([
        ["account-a", "viking://user/account-a/memories/profile.md"],
        ["account-b", "viking://user/account-b/memories/profile.md"],
      ]),
    );
  });

  it("asks the server again once the endpoint moves elsewhere", async () => {
    harness = await createHarness(
      { endpoint: "http://space-old.example", user: "shared-account" },
      {
        fetchImpl: spaceServer({
          spacesByHost: {
            "space-old.example": "legacy-space",
            "space-new.example": "fresh-space",
          },
        }),
      },
    );

    await startSession(harness, "dsh-first");
    expect(profileReads(harness)[0]?.uri).toBe(
      "viking://user/legacy-space/memories/profile.md",
    );

    // The operator repoints the installation: the same account name, a server
    // that keeps its memory under a space that never existed on the old one.
    harness.plugin.runtime.reconfigure(
      resolveConfig({
        endpoint: "http://space-new.example",
        user: "shared-account",
      }),
      harness.plugin.injection,
    );
    await startSession(harness, "dsh-second");

    expect(profileReads(harness)[1]?.uri).toBe(
      "viking://user/fresh-space/memories/profile.md",
    );
  });
});
