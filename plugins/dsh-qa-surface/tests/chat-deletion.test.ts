import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaAccounts } from "../src/accounts/store.js";
import {
  createSessionEraser,
  staticSessionLogReader,
  type QaStoredSessionHeader,
} from "../src/admin/session-log.js";
import { QaChatDeletion } from "../src/chat-deletion.js";
import { QaChatSharingStore } from "../src/chat-sharing/store.js";

const USER = "owner@example.test";
const READER = "reader@example.test";
const PASSWORD = "synthetic-chat-credential";
const ROOT: QaStoredSessionHeader = { id: "chat", createdAt: 1 };
const CHILD: QaStoredSessionHeader = {
  id: "agent",
  createdAt: 2,
  parentSessionId: ROOT.id,
};
const FORK: QaStoredSessionHeader = {
  id: "fork",
  createdAt: 3,
  parentSessionId: ROOT.id,
  isFork: true,
};

describe("owner chat deletion", () => {
  let home: string;
  let accounts: QaAccounts;
  let sharing: QaChatSharingStore;
  let headers: QaStoredSessionHeader[];
  let held: Set<string>;
  let complete: boolean;
  let owner: string;
  let reader: string;
  let dropMetadata: ReturnType<
    typeof vi.fn<(sessions: readonly string[]) => void>
  >;
  let fenceLive: ReturnType<typeof vi.fn<(id: string) => void>>;

  const sessionDir = (id: string) => join(home, "sessions", "project", id);

  function add(header: QaStoredSessionHeader) {
    headers.push(header);
    mkdirSync(sessionDir(header.id), { recursive: true });
    writeFileSync(
      join(sessionDir(header.id), "session.jsonl"),
      "fixture history",
    );
  }

  function openStores() {
    accounts = new QaAccounts(join(home, "accounts.db"), {
      sessionTtlDays: 1,
      allowRegistration: true,
    });
    sharing = new QaChatSharingStore(join(home, "sharing.db"), () => accounts);
  }

  function closeStores() {
    sharing.storage.close();
    accounts.close();
  }

  function deletion() {
    return new QaChatDeletion({
      log: {
        ...staticSessionLogReader({}),
        list: () =>
          Promise.resolve({
            headers: headers.filter(({ id }) => existsSync(sessionDir(id))),
            complete,
          }),
        live: (id) => held.has(id),
      },
      sharing: () => sharing,
      files: createSessionEraser(home),
      logger: { warn: vi.fn(), info: vi.fn() },
      dropMetadata,
      fenceLive,
      home,
    });
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "qa-owned-chat-fixture-"));
    headers = [];
    held = new Set();
    complete = true;
    dropMetadata = vi.fn();
    fenceLive = vi.fn();
    openStores();
    accounts.register("admin@example.test", PASSWORD);
    owner = accounts.register(USER, PASSWORD).token;
    reader = accounts.register(READER, PASSWORD).token;
    add(ROOT);
    add(CHILD);
    add(FORK);
    accounts.reserveSession(owner, ROOT.id, { subroleId: "fixture-role" });
    accounts.reserveSession(owner, FORK.id, { subroleId: "fixture-role" });
  });

  afterEach(() => {
    closeStores();
    rmSync(home, { recursive: true, force: true });
  });

  it("rejects readers, the deployment admin and shared chats before deleting a private tree", async () => {
    const service = deletion();
    const admin = accounts.login("admin@example.test", PASSWORD).token;
    await expect(
      service.request(accounts, reader, ROOT.id),
    ).rejects.toMatchObject({ reason: "conversation-unknown" });
    await expect(
      service.request(accounts, admin, ROOT.id),
    ).rejects.toMatchObject({ reason: "conversation-unknown" });
    sharing.set(owner, ROOT.id, READER, "read");
    await expect(
      service.request(accounts, owner, ROOT.id),
    ).rejects.toMatchObject({ reason: "conversation-shared" });
    expect(sharing.access(reader, ROOT.id).mode).toBe("read");
    expect(existsSync(sessionDir(ROOT.id))).toBe(true);
    sharing.set(owner, ROOT.id, READER, null);

    await expect(service.request(accounts, owner, ROOT.id)).resolves.toEqual({
      state: "deleted",
    });
    expect(existsSync(sessionDir(ROOT.id))).toBe(false);
    expect(existsSync(sessionDir(CHILD.id))).toBe(false);
    expect(existsSync(sessionDir(FORK.id))).toBe(true);
    expect(accounts.ownedSessionIds(owner)).toEqual([FORK.id]);
    expect(() => sharing.access(owner, ROOT.id)).toThrow(
      "Chat access is unavailable.",
    );
    expect(() => sharing.access(reader, ROOT.id)).toThrow(
      "Chat access is unavailable.",
    );
    await expect(service.request(accounts, owner, ROOT.id)).resolves.toEqual({
      state: "deleted",
    });
  });

  it("persists pending deletion and resumes it with the complete delegated tree after restart", async () => {
    held.add(CHILD.id);
    await expect(deletion().request(accounts, owner, ROOT.id)).resolves.toEqual(
      { state: "pending" },
    );
    expect(fenceLive).toHaveBeenCalledWith(CHILD.id);
    expect(existsSync(sessionDir(ROOT.id))).toBe(true);
    expect(accounts.ownedSessionIds(owner)).toEqual([FORK.id]);
    expect(() => accounts.ensureSessionAccess(owner, ROOT.id)).toThrow();
    expect(accounts.claimSessions(reader, [ROOT.id, CHILD.id])).toEqual({
      claimed: 0,
      conflicts: [ROOT.id, CHILD.id],
    });
    expect(() => accounts.reserveSession(reader, ROOT.id)).toThrow();

    closeStores();
    openStores();
    add({ id: "late-agent", createdAt: 4, parentSessionId: CHILD.id });
    add({ id: "fork-agent", createdAt: 4, parentSessionId: FORK.id });
    held.clear();
    const resumed = deletion();
    await resumed.recover(accounts);
    expect(existsSync(sessionDir(ROOT.id))).toBe(false);
    expect(existsSync(sessionDir(CHILD.id))).toBe(false);
    expect(existsSync(sessionDir("late-agent"))).toBe(false);
    expect(existsSync(sessionDir(FORK.id))).toBe(true);
    expect(existsSync(sessionDir("fork-agent"))).toBe(true);
    expect(accounts.pendingChatDeletions()).toEqual([]);
    expect(
      accounts.claimSessions(owner, [ROOT.id, "late-agent"]).conflicts,
    ).toEqual([ROOT.id, "late-agent"]);
  });

  it("retries an erasure interrupted after file removal without restoring access", async () => {
    dropMetadata.mockImplementationOnce(() => {
      throw new Error("fixture interruption");
    });
    const service = deletion();
    await expect(service.request(accounts, owner, ROOT.id)).resolves.toEqual({
      state: "pending",
    });
    expect(existsSync(sessionDir(ROOT.id))).toBe(false);
    expect(accounts.pendingChatDeletions()).toEqual([ROOT.id]);
    expect(() => sharing.access(owner, ROOT.id)).toThrow();
    closeStores();
    openStores();
    await deletion().recover(accounts);
    expect(accounts.pendingChatDeletions()).toEqual([]);
    expect(dropMetadata).toHaveBeenCalledTimes(2);
    expect(() => sharing.access(owner, ROOT.id)).toThrow();
  });

  it("refuses incomplete enumeration and a descendant owned by another account", async () => {
    const service = deletion();
    complete = false;
    await expect(
      service.request(accounts, owner, ROOT.id),
    ).rejects.toMatchObject({ reason: "conversation-list-incomplete" });
    complete = true;
    accounts.reserveSession(reader, CHILD.id);
    await expect(
      service.request(accounts, owner, ROOT.id),
    ).rejects.toMatchObject({ reason: "conversation-not-removable" });
    expect(accounts.pendingChatDeletions()).toEqual([]);
    expect(sharing.access(owner, ROOT.id).mode).toBe("owner");
    expect(existsSync(sessionDir(CHILD.id))).toBe(true);
  });

  it("does not turn a browser-index claim into authority to erase a Host log", async () => {
    const reclaimed = { id: "legacy-host-chat", createdAt: 1 };
    add(reclaimed);
    expect(accounts.claimSessions(owner, [reclaimed.id]).claimed).toBe(1);
    await expect(
      deletion().request(accounts, owner, reclaimed.id),
    ).rejects.toMatchObject({
      reason: "conversation-not-removable",
    });
    expect(existsSync(sessionDir(reclaimed.id))).toBe(true);
  });
});
