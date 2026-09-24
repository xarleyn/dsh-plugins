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
      ownership: [],
    });
    expect(accounts.messageAuthorOf("s-1")).toBeUndefined();
  });
});
