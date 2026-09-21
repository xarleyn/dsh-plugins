/**
 * The account-scoped settings Remote: the page authenticates with a token the
 * Host resolves to an account, and no method accepts an account id from the
 * caller. A refused token is the whole authorization story, so it is asserted
 * for every method.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "./helpers/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

/** Tokens are the only identity the browser supplies. */
const TOKENS = { "token-a": "account-a" };

async function harnessWithAccounts(): Promise<Harness> {
  return await createHarness(
    {},
    {
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

describe("account-scoped settings Remote", () => {
  it("reports the deployment's plan and an all-inherit account", async () => {
    harness = await harnessWithAccounts();

    const view = harness.plugin.userMemorySettings("token-a");

    expect(view).toEqual({
      autoInject: null,
      profile: null,
      recall: null,
      effective: { startupProfile: true, stepProfile: true, recall: true },
      configured: { startupProfile: true, stepProfile: true, recall: true },
      scoped: true,
    });
  });

  it("narrows one account without touching another", async () => {
    harness = await harnessWithAccounts();

    const stored = harness.plugin.setUserMemorySettings("token-a", {
      autoInject: false,
    });

    expect(stored.autoInject).toBe(false);
    expect(stored.effective).toEqual({
      startupProfile: false,
      stepProfile: false,
      recall: false,
    });
    expect(harness.plugin.userMemorySettings("token-a").autoInject).toBe(false);
    expect(stored.configured).toEqual({
      startupProfile: true,
      stepProfile: true,
      recall: true,
    });
  });

  it("hands a knob back to the deployment on null, and everything on reset", async () => {
    harness = await harnessWithAccounts();
    harness.plugin.setUserMemorySettings("token-a", { recall: false });

    expect(
      harness.plugin.setUserMemorySettings("token-a", { recall: null }).recall,
    ).toBe(null);
    expect(harness.plugin.userMemorySettings("token-a").recall).toBe(null);

    harness.plugin.setUserMemorySettings("token-a", { autoInject: false });
    expect(harness.plugin.resetUserMemorySettings("token-a").autoInject).toBe(
      null,
    );
  });

  it("reports an unscoped deployment", async () => {
    harness = await createHarness(
      { qaUserScoping: false },
      {
        qaSurface: {
          principalForSession: () => undefined,
          principalForToken: (token) =>
            token === "token-a" ? { userId: "account-a" } : undefined,
        },
      },
    );

    expect(harness.plugin.userMemorySettings("token-a").scoped).toBe(false);
  });

  it("refuses every method for a token no account owns", async () => {
    harness = await harnessWithAccounts();

    expect(() => harness!.plugin.userMemorySettings("nobody")).toThrow();
    expect(() =>
      harness!.plugin.setUserMemorySettings("nobody", { recall: false }),
    ).toThrow();
    expect(() => harness!.plugin.resetUserMemorySettings("nobody")).toThrow();
  });

  it("refuses every method when the deployment mounts no QA surface", async () => {
    harness = await createHarness({});

    expect(() => harness!.plugin.userMemorySettings("token-a")).toThrow();
  });
});
