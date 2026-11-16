import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSessionPurge } from "../../src/admin/session-purge.js";
import { fakeEraser, harness } from "./admin-service.helpers.js";
import { staticSessionLogReader } from "../../src/admin/session-log.js";
import type { QaStoredSessionHeader } from "../../src/admin/session-log.js";

describe("admin account removal", () => {
  it("restores conversations, quality records and shared access when the final SQLite commit fails", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "qa-removal-commit-"));
    const purge = createSessionPurge(vi.fn(), vi.fn(), home);
    const f = harness({ sessionPurge: purge });
    const session = "session-alice";
    const directory = path.join(home, "sessions", "project", session);
    const db = new DatabaseSync(f.accounts.filePath);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "log"), "retained bytes");
      f.quality.rateFeedback(
        { conversationId: session, messageId: "2", userId: f.alice.user.id },
        { rating: "positive" },
      );
      f.sharing().set(f.alice.token, session, f.bob.user.email, "read");
      db.exec(
        "CREATE TABLE fixture_reference (account_id TEXT REFERENCES qa_accounts(id) DEFERRABLE INITIALLY DEFERRED)",
      );
      db.prepare("INSERT INTO fixture_reference VALUES (?)").run(
        f.alice.user.id,
      );
      await expect(
        f.service.deleteUser(f.admin.token, f.alice.user.id, true),
      ).rejects.toThrow(/FOREIGN KEY/i);
      expect(readFileSync(path.join(directory, "log"), "utf8")).toBe(
        "retained bytes",
      );
      expect(f.accounts.whoami(f.alice.token).authenticated).toBe(true);
      expect(f.quality.allFeedback()).toHaveLength(1);
      expect(
        f.quality
          .auditEvents()
          .filter((event) => event.action === "user.deleted"),
      ).toEqual([]);
      expect(f.sharing().grants(f.alice.token, session)).toHaveLength(1);
      db.exec("DELETE FROM fixture_reference");
      expect(
        await f.service.deleteUser(f.admin.token, f.alice.user.id, true),
      ).toBe(1);
      expect(f.quality.allFeedback()).toEqual([]);
      expect(
        f.quality
          .auditEvents()
          .filter((event) => event.action === "user.deleted"),
      ).toHaveLength(1);
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    "restores pending histories before listing and refuses any later restoration (%s)",
    async (late) => {
      let recovered = false;
      const source = staticSessionLogReader({});
      const stage = vi.fn(
        (_accounts: unknown, _user: string, targets: readonly string[]) => ({
          removed: targets,
          absent: [],
        }),
      );
      const f = harness({
        sessionPurge: {
          stage,
          recover() {
            const alreadyRecovered = recovered;
            recovered = true;
            return !alreadyRecovered || late;
          },
        },
        sessionLog: {
          ...source,
          list: async () => ({
            complete: true,
            headers: recovered
              ? [
                  {
                    id: "child",
                    parentSessionId: "session-alice",
                    createdAt: 2,
                  },
                ]
              : [],
          }),
        },
      });
      const removal = f.service.deleteUser(
        f.admin.token,
        f.alice.user.id,
        true,
      );
      if (late) {
        await expect(removal).rejects.toMatchObject({
          reason: "account-changed",
        });
        expect(stage).not.toHaveBeenCalled();
      } else {
        await expect(removal).resolves.toBe(1);
        expect(stage.mock.calls[0]?.[2]).toEqual(["session-alice", "child"]);
      }
    },
  );
  it.each([false, true])(
    "rolls credentials and shared access back on audit failure before erasing files (purge=%s)",
    async (purge) => {
      const files = fakeEraser(["session-alice"]);
      const { service, accounts, admin, alice, bob, quality, sharing } =
        harness({ sessionFiles: files });
      const store = sharing();
      store.set(alice.token, "session-alice", bob.user.email, "collaborate");
      store.recordAuthor(
        alice.token,
        store.access(alice.token, "session-alice"),
        "q",
      );
      const token = accounts.mintServiceToken(alice.token);
      vi.spyOn(quality, "appendAudit").mockImplementationOnce(() => {
        throw new Error("audit unavailable");
      });
      await expect(
        service.deleteUser(admin.token, alice.user.id, purge),
      ).rejects.toThrow("audit unavailable");
      expect(accounts.verifyServiceToken(token.token)?.userId).toBe(
        alice.user.id,
      );
      expect(store.grants(alice.token, "session-alice")).toHaveLength(1);
      expect(store.requestActor("session-alice", "q")?.displayName).toBe(
        alice.user.displayName,
      );
      expect(files.calls).toHaveLength(0);
      expect(await service.deleteUser(admin.token, alice.user.id, purge)).toBe(
        1,
      );
      expect(store.requestActor("session-alice", "q")?.displayName).toBe(
        purge ? undefined : "Удалённый пользователь",
      );
      expect(
        store.storage.db.prepare("SELECT 1 FROM grants").get(),
      ).toBeUndefined();
      expect(accounts.verifyServiceToken(token.token)).toBeNull();
    },
  );
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
    expect(() =>
      accounts.ensureSessionAccess(admin.token, "session-alice"),
    ).toThrow(expect.objectContaining({ reason: "session-owned-elsewhere" }));
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

  it("refuses a delegation which started and finished while the durable listing was pending", async () => {
    const files = fakeEraser(["session-alice"]);
    let record: ((header: QaStoredSessionHeader) => void) | undefined;
    const stop = vi.fn();
    const { service, accounts, admin, alice } = harness({
      sessionFiles: files,
      sessionLog: {
        ...staticSessionLogReader({
          sessions: [{ id: "session-alice", createdAt: 1 }],
        }),
        watchCreated(listener) {
          record = listener;
          return stop;
        },
      },
    });
    const removal = service.deleteUser(admin.token, alice.user.id, true);
    record?.({
      id: "finished-child",
      parentSessionId: "session-alice",
      createdAt: 2,
    });
    await expect(removal).rejects.toMatchObject({ reason: "account-changed" });
    expect(stop).toHaveBeenCalledOnce();
    expect(files.calls).toEqual([]);
    expect(accounts.ownerIdOf("session-alice")).toBe(alice.user.id);
  });

  it("rechecks ownership before erasure if a session was reserved during listing", async () => {
    const files = fakeEraser(["session-alice"]);
    const log = staticSessionLogReader({});
    const { service, accounts, admin, alice } = harness({
      sessionFiles: files,
      sessionLog: log,
    });
    const pending = service.deleteUser(admin.token, alice.user.id, true);
    accounts.reserveSession(alice.token, "new-chat");
    await expect(pending).rejects.toMatchObject({ reason: "account-changed" });
    expect(files.calls).toHaveLength(0);
    expect(accounts.ownedSessionIds(alice.token)).toHaveLength(2);
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
    expect(() =>
      accounts.reserveSessionForUser(alice.user, "late-chat"),
    ).toThrow(expect.objectContaining({ reason: "account-unknown" }));
    expect(accounts.ownerIdOf("late-chat")).toBeUndefined();
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
