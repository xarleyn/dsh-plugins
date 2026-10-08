import { describe, expect, it, vi } from "vitest";
import { controller, remote, session } from "./accounts-controller.helpers.js";

describe("QA accounts controller", () => {
  it("merges the admin ownership view into the visible chat ids", async () => {
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
      accountsListOwnership: vi.fn(async () => ({
        ok: true as const,
        value: {
          entries: [
            {
              sessionId: "s-mine",
              userId: "u-1",
              displayName: "a",
              claimedAt: "2026-09-11T00:00:00.000Z",
            },
            {
              sessionId: "s-foreign",
              userId: "u-2",
              displayName: "Борис",
              claimedAt: "2026-09-11T00:01:00.000Z",
            },
          ],
        },
      })),
    });
    const accounts = controller(api, { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).toHaveBeenCalledWith("t-login");
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-mine", "s-foreign"],
    });
    expect(accounts.ownerNames().get("s-foreign")).toBe("Борис");
    // Author labels: foreign chats only.
    expect(accounts.messageAuthorOf("s-foreign")).toBe("Борис");
    expect(accounts.messageAuthorOf("s-mine")).toBeUndefined();
  });

  it("does not request or show other users' chats by default", async () => {
    const api = remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
      accountsListOwnership: vi.fn(async () => ({
        ok: true as const,
        value: {
          entries: [
            {
              sessionId: "s-foreign",
              userId: "u-2",
              displayName: "Boris",
              claimedAt: "2026-09-11T00:01:00.000Z",
            },
          ],
        },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).not.toHaveBeenCalled();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-mine"],
      ownership: [],
    });
    expect(accounts.ownerNames().size).toBe(0);
    expect(accounts.messageAuthorOf("s-foreign")).toBeUndefined();
  });

  it("keeps ordinary accounts out of the ownership view", async () => {
    const api = remote({
      accountsLogin: vi.fn(async () => ({
        ok: true as const,
        value: {
          token: "t-user",
          user: {
            ...session("t-user").value.user,
            id: "u-9",
            role: "user" as const,
          },
        },
      })),
    });
    const accounts = controller(api);
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(api.accountsListOwnership).not.toHaveBeenCalled();
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-1"],
      ownership: [],
    });
    expect(accounts.ownerNames().size).toBe(0);
    expect(accounts.messageAuthorOf("s-1")).toBeUndefined();
  });

  it("degrades gracefully when the ownership listing is refused", async () => {
    const api = remote({
      accountsListOwnership: vi.fn(async () => ({
        ok: false as const,
        error: new Error("refused (reason: admin-required)"),
      })),
    });
    const accounts = controller(api, { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(accounts.getSnapshot()).toMatchObject({
      stage: "authed",
      ownedIds: ["s-1"],
      ownIds: ["s-1"],
      ownership: [],
    });
    expect(accounts.messageAuthorOf("s-1")).toBeUndefined();
  });
});

/**
 * The list a notice is bounded by. The sidebar may show an admin every chat it
 * is allowed to read; a surface that carries a chat's state out of the page is
 * bounded by what the account owns, and the two must not be the same array.
 */
describe("the strictly owned chat list", () => {
  const crossUserApi = (): ReturnType<typeof remote> =>
    remote({
      accountsOwnedSessions: vi.fn(async () => ({
        ok: true as const,
        value: { ids: ["s-mine"] },
      })),
      accountsListOwnership: vi.fn(async () => ({
        ok: true as const,
        value: {
          entries: [
            {
              sessionId: "s-mine",
              userId: "u-1",
              displayName: "a",
              claimedAt: "2026-09-11T00:00:00.000Z",
            },
            {
              sessionId: "s-foreign",
              userId: "u-2",
              displayName: "Борис",
              claimedAt: "2026-09-11T00:01:00.000Z",
            },
          ],
        },
      })),
    });

  it("stays at the account's own chats while the list grows past them", async () => {
    const accounts = controller(crossUserApi(), { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");

    expect(accounts.ownedIds()).toEqual(["s-mine", "s-foreign"]);
    expect(accounts.ownIds()).toEqual(["s-mine"]);
  });

  it("takes a chat this page claims into both lists", async () => {
    const accounts = controller(crossUserApi(), { showOtherUsersChats: true });
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    await accounts.claimNewSession("s-new");

    expect(accounts.ownIds()).toEqual(["s-mine", "s-new"]);
    expect(accounts.ownedIds()).toEqual(["s-mine", "s-foreign", "s-new"]);
  });

  it("notices a lost chat the merged list still names through the map", async () => {
    let owned: readonly string[] = ["s-mine"];
    const accounts = controller(
      remote({
        accountsOwnedSessions: vi.fn(async () => ({
          ok: true as const,
          value: { ids: owned },
        })),
        accountsListOwnership: vi.fn(async () => ({
          ok: true as const,
          value: {
            entries: [
              {
                sessionId: "s-mine",
                userId: "u-1",
                displayName: "a",
                claimedAt: "2026-09-11T00:00:00.000Z",
              },
            ],
          },
        })),
      }),
      { showOtherUsersChats: true },
    );
    await accounts.start();
    await accounts.login("a@b.co", "password-1");
    expect(accounts.ownIds()).toEqual(["s-mine"]);
    expect(accounts.ownedIds()).toEqual(["s-mine"]);

    // The account no longer owns the chat, but the ownership map still names
    // it: the merged list is unchanged, so only the strict one can report it.
    owned = [];
    await accounts.refreshOwned();
    expect(accounts.ownIds()).toEqual([]);
    expect(accounts.ownedIds()).toEqual(["s-mine"]);
  });

  it("is the whole list for an account that reads no shared history", async () => {
    const accounts = controller(
      remote({
        accountsLogin: vi.fn(async () => ({
          ok: true as const,
          value: {
            token: "t-user",
            user: { ...session("t-user").value.user, role: "user" as const },
          },
        })),
        accountsOwnedSessions: vi.fn(async () => ({
          ok: true as const,
          value: { ids: ["s-mine"] },
        })),
      }),
      { showOtherUsersChats: true },
    );
    await accounts.start();
    await accounts.login("a@b.co", "password-1");

    expect(accounts.ownIds()).toEqual(["s-mine"]);
    expect(accounts.ownedIds()).toEqual(["s-mine"]);
  });
});
