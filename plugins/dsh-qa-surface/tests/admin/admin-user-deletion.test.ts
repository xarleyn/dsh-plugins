import { describe, expect, it, vi } from "vitest";
import { fakeEraser, harness } from "./admin-service.helpers.js";
import { staticSessionLogReader } from "../../src/admin/session-log.js";

describe("admin account removal", () => {
  it("rolls the credential deletion back and permits a retry when recording the removal fails", async () => {
    const { service, accounts, admin, alice, quality } = harness();
    const token = accounts.mintServiceToken(alice.token);
    vi.spyOn(quality, "appendAudit").mockImplementationOnce(() => {
      throw new Error("audit unavailable");
    });
    await expect(
      service.deleteUser(admin.token, alice.user.id),
    ).rejects.toThrow("audit unavailable");
    expect(accounts.verifyServiceToken(token.token)?.userId).toBe(
      alice.user.id,
    );
    expect(await service.deleteUser(admin.token, alice.user.id)).toBe(1);
    expect(accounts.verifyServiceToken(token.token)).toBeNull();
  });
  it("revokes credentials, releases the email and retains history without an eraser", async () => {
    const { service, accounts, quality, admin, alice } = harness();
    const credential = accounts.mintServiceToken(alice.token);
    accounts.requestPasswordReset(alice.user.email);
    quality.rateFeedback(
      {
        conversationId: "session-alice",
        messageId: "2",
        userId: alice.user.id,
      },
      { rating: "positive" },
    );
    expect(await service.deleteUser(admin.token, alice.user.id)).toBe(1);
    expect(accounts.accountById(alice.user.id, true)).toBeUndefined();
    expect(accounts.whoami(alice.token)).toEqual({ authenticated: false });
    expect(accounts.verifyServiceToken(credential.token)).toBeNull();
    expect(accounts.passwordResetRequests()).toEqual([]);
    const chat = await service.conversation(admin.token, "session-alice");
    expect(chat.summary.displayName).toBe("Удалённый пользователь");
    expect(chat.messages.length).toBeGreaterThan(0);
    expect(quality.allFeedback()).toHaveLength(1);
    const replacement = accounts.register(alice.user.email, "new-password-1");
    expect(replacement.user.id).not.toBe(alice.user.id);
    expect(
      accounts.claimSessions(replacement.token, ["session-alice"]).claimed,
    ).toBe(0);
    expect(accounts.ownedSessionIds(replacement.token)).toEqual([]);
    expect(quality.auditEvents().at(-1)).toMatchObject({
      action: "user.deleted",
      actorId: admin.user.id,
      targetId: alice.user.id,
    });
  });

  it("erases all owned conversations and their delegated sessions but preserves another owner's fork", async () => {
    const files = fakeEraser(["session-alice", "second", "child", "fork"]);
    const { service, accounts, quality, admin, alice, bob } = harness({
      sessionFiles: files,
      extraSessions: [
        { id: "second", createdAt: 2 },
        { id: "child", createdAt: 3, parentSessionId: "second" },
        { id: "fork", createdAt: 4, parentSessionId: "second", isFork: true },
      ],
    });
    accounts.reserveSession(alice.token, "second");
    accounts.reserveSession(bob.token, "fork");
    quality.enqueueReview(admin.user.id, "second", "1");
    expect(await service.deleteUser(admin.token, alice.user.id, true)).toBe(2);
    expect(files.calls).toHaveLength(1);
    expect(new Set(files.calls[0])).toEqual(
      new Set(["session-alice", "second", "child"]),
    );
    expect(accounts.ownerIdOf("second")).toBeUndefined();
    expect(accounts.ownerIdOf("fork")).toBe(bob.user.id);
    expect(quality.manualQueue()).toEqual([]);
    expect(accounts.whoami(alice.token).authenticated).toBe(false);
  });

  it("checks permissions, the last administrator and every live conversation before erasing any", async () => {
    const files = fakeEraser(["session-alice", "busy"]);
    const { service, accounts, admin, reviewer, alice } = harness({
      sessionFiles: files,
      held: ["busy"],
    });
    accounts.reserveSession(alice.token, "busy");
    await expect(
      service.deleteUser(admin.token, alice.user.id, true, 1),
    ).rejects.toMatchObject({ reason: "account-changed" });
    await expect(
      service.deleteUser(reviewer.token, alice.user.id, true),
    ).rejects.toMatchObject({ reason: "forbidden" });
    await expect(
      service.deleteUser(admin.token, admin.user.id, true),
    ).rejects.toMatchObject({ reason: "last-admin" });
    await expect(
      service.deleteUser(admin.token, alice.user.id, true),
    ).rejects.toMatchObject({ reason: "conversation-live" });
    expect(files.calls).toEqual([]);
    expect(accounts.whoami(alice.token).authenticated).toBe(true);
    expect(accounts.ownedSessionIds(alice.token)).toHaveLength(2);
  });

  it("keeps the account on an incomplete listing and supports disabled accounts without conversations", async () => {
    const { service, accounts, admin, alice } = harness({
      sessionLog: staticSessionLogReader({ complete: false }),
    });
    await expect(
      service.deleteUser(admin.token, alice.user.id, true),
    ).rejects.toMatchObject({ reason: "conversation-list-incomplete" });
    const inactive = accounts.addUser("inactive@example.org", "password-1");
    accounts.setUserDisabled(inactive.email, true);
    expect(await service.deleteUser(admin.token, inactive.id, true)).toBe(0);
    expect(accounts.accountById(inactive.id, true)).toBeUndefined();
  });
});
