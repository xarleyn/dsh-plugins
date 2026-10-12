import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaAccounts } from "../../src/accounts/store.js";
import { QaChatSharingStore } from "../../src/chat-sharing/store.js";

const stores: QaChatSharingStore[] = [];
export function sharingFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-sharing-test-"));
  const accounts = new QaAccounts(path.join(dir, "accounts.db"), {
    allowRegistration: true,
    sessionTtlDays: 30,
    maxAuthAttemptsPerMinute: 100,
  });
  const outsider = accounts.register(
    "operator@example.com",
    "demo-password-123",
  );
  const owner = accounts.register("owner@example.com", "demo-password-123");
  const reader = accounts.register("reader@example.com", "demo-password-123");
  const collaborator = accounts.register(
    "collaborator@example.com",
    "demo-password-123",
  );
  accounts.reserveSession(owner.token, "chat-a");
  const dbPath = path.join(dir, "sharing.db");
  const store = new QaChatSharingStore(dbPath, () => accounts);
  stores.push(store);
  store.set(owner.token, "chat-a", reader.user.email, "read");
  store.set(owner.token, "chat-a", collaborator.user.email, "collaborate");
  return { store, accounts, owner, reader, collaborator, outsider, dbPath };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.storage.close();
});

describe("durable chat membership", () => {
  it("resolves one account provider per visibility batch and reads current grants on the next batch", () => {
    const f = sharingFixture();
    for (let i = 0; i < 30; i++)
      f.accounts.reserveSession(f.owner.token, `synthetic-chat-${i}`);
    const provider = vi.fn(() => f.accounts);
    const store = new QaChatSharingStore(f.dbPath, provider);
    stores.push(store);
    expect(store.visible(f.owner.token)).toHaveLength(31);
    expect(provider).toHaveBeenCalledOnce();
    expect(store.visible(f.reader.token)).toHaveLength(1);
    f.store.set(f.owner.token, "chat-a", f.reader.user.email, null);
    expect(store.visible(f.reader.token)).toEqual([]);
  });

  it("gates owner, reader, collaborator and outsider without administrator inheritance", () => {
    const f = sharingFixture();
    expect(f.store.owner(f.owner.token, "chat-a").mode).toBe("owner");
    expect(f.store.access(f.reader.token, "chat-a").mode).toBe("read");
    expect(() => f.store.write(f.reader.token, "chat-a")).toThrow("read-only");
    expect(f.store.write(f.collaborator.token, "chat-a").mode).toBe(
      "collaborate",
    );
    expect(() => f.store.access(f.outsider.token, "chat-a")).toThrow(
      "unavailable",
    );
    expect(() => f.store.owner(f.collaborator.token, "chat-a")).toThrow(
      "owner",
    );
    expect(() =>
      f.store.set(
        f.reader.token,
        "chat-a",
        f.outsider.user.email,
        "collaborate",
      ),
    ).toThrow("owner");
    expect(() => f.store.access("invalid-token", "chat-a")).toThrow();
    expect(() => f.store.access(f.reader.token, "guessed-id")).toThrow(
      "unavailable",
    );
  });
  it("persists grants and observes a concurrent writer without process-local caching", () => {
    const f = sharingFixture();
    const second = new QaChatSharingStore(f.dbPath, () => f.accounts);
    stores.push(second);
    expect(second.access(f.reader.token, "chat-a").mode).toBe("read");
    const old = f.store.access(f.reader.token, "chat-a");
    second.set(f.owner.token, "chat-a", f.reader.user.email, "collaborate");
    expect(f.store.write(f.reader.token, "chat-a").mode).toBe("collaborate");
    expect(() => f.store.revalidate(f.reader.token, old)).toThrow("changed");
    second.set(f.owner.token, "chat-a", f.reader.user.email, null);
    expect(() => f.store.access(f.reader.token, "chat-a")).toThrow(
      "unavailable",
    );
    second.set(f.owner.token, "chat-a", f.reader.user.email, "read");
    expect(f.store.access(f.reader.token, "chat-a").revision).toBeGreaterThan(
      old.revision,
    );
  });
  it("does not copy grants to a fork or grant filesystem/account directory powers", () => {
    const f = sharingFixture();
    f.accounts.reserveSession(f.owner.token, "branch-a");
    expect(
      f.store.visible(f.owner.token).map((item) => item.sessionId),
    ).toContain("branch-a");
    expect(
      f.store.visible(f.reader.token).map((item) => item.sessionId),
    ).toEqual(["chat-a"]);
    expect(() => f.store.access(f.reader.token, "branch-a")).toThrow();
    expect(() => f.store.grants(f.reader.token, "chat-a")).toThrow("owner");
    expect(() =>
      f.store.set(f.owner.token, "chat-a", "unknown@example.com", "read"),
    ).toThrow("unavailable");
    expect(() =>
      f.store.set(
        f.owner.token,
        "chat-a",
        f.reader.user.email,
        "invalid" as never,
      ),
    ).toThrow("mode");
  });
  it("keeps authors immutable and revokes pending input epochs on downgrade and disable", () => {
    const f = sharingFixture();
    const access = f.store.write(f.collaborator.token, "chat-a");
    f.store.recordAuthor(f.collaborator.token, access, "request-demo");
    expect(f.store.authors(f.reader.token, "chat-a")[0]).toMatchObject({
      requestId: "request-demo",
      userId: f.collaborator.user.id,
    });
    expect(() =>
      f.store.recordAuthor(
        f.owner.token,
        f.store.owner(f.owner.token, "chat-a"),
        "request-demo",
      ),
    ).toThrow();
    expect(
      f.store.actorStillAllowed("chat-a", access.actorId, access.revision),
    ).toBe(true);
    f.store.set(f.owner.token, "chat-a", f.collaborator.user.email, "read");
    expect(
      f.store.actorStillAllowed("chat-a", access.actorId, access.revision),
    ).toBe(false);
    f.accounts.setUserDisabled(f.reader.user.email, true);
    expect(() => f.store.access(f.reader.token, "chat-a")).toThrow();
    expect(
      f.store
        .grants(f.owner.token, "chat-a")
        .some((item) => item.userId === f.reader.user.id),
    ).toBe(true);
    expect(() =>
      f.store.set(f.owner.token, "chat-a", f.reader.user.email, null),
    ).not.toThrow();
  });
  it("retains only prefix authors on a branch and removes deleted chat grants permanently", () => {
    const f = sharingFixture();
    const access = f.store.write(f.collaborator.token, "chat-a");
    f.store.recordAuthor(f.collaborator.token, access, "inherited-request");
    f.store.recordAuthor(f.collaborator.token, access, "later-request");
    f.accounts.reserveSession(f.owner.token, "branch-a");
    f.store.forkAuthors("chat-a", "branch-a", ["inherited-request"]);
    expect(f.store.authors(f.owner.token, "branch-a")).toHaveLength(1);
    expect(f.store.authors(f.owner.token, "branch-a")[0]?.userId).toBe(
      f.collaborator.user.id,
    );
    expect(f.store.grants(f.owner.token, "branch-a")).toEqual([]);
    f.store.dropSession("chat-a");
    expect(() => f.store.access(f.reader.token, "chat-a")).toThrow();
    expect(f.store.authors(f.owner.token, "branch-a")).toHaveLength(1);
  });
});
