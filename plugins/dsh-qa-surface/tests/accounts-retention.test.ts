import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotDigest } from "../src/accounts/file.js";
import { QaAccounts } from "../src/accounts/store.js";
import type { QaEffectiveCapabilityPolicy } from "../src/types.js";

/** A minimal frozen policy; only its content matters to the store. */
function policy(
  revision: string,
  tools: readonly string[] = ["read"],
): QaEffectiveCapabilityPolicy {
  return {
    subroleId: "general",
    tools,
    grantableTools: [],
    skills: [],
    userSkills: [],
    sources: {
      systemTools: [...tools],
      commonTools: [],
      roleTools: [],
      commonGrantableTools: [],
      roleGrantableTools: [],
      systemSkills: [],
      commonSkills: [],
      roleSkills: [],
      declaredSkills: [],
    },
    missingTools: [],
    missingSkills: [],
    policyRevision: revision,
  };
}

function rig(): { store: QaAccounts; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-retention-"));
  const file = path.join(dir, "qa-accounts.db");
  return { file, store: openStore(file) };
}

function openStore(file: string): QaAccounts {
  return new QaAccounts(file, {
    sessionTtlDays: 30,
    allowRegistration: true,
    maxAuthAttemptsPerMinute: 100,
  });
}

/** Read the first column of a query out of the store's own database. */
function column<T>(file: string, sql: string, ...params: string[]): T[] {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as T,
    );
  } finally {
    db.close();
  }
}

function run(file: string, sql: string, ...params: string[]): void {
  const db = new DatabaseSync(file);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

describe("QA accounts: capability snapshot storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one copy of a policy shared by many chats", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    const shared = policy("rev-1");
    for (const sessionId of ["session-a", "session-b", "session-c"]) {
      accounts.reserveSession(token, sessionId, { subroleId: "general" });
      accounts.updateSessionAccess(sessionId, { capabilitySnapshot: shared });
    }

    // One snapshot row, three chats pointing at it — and the read model is
    // unchanged: callers still get the snapshot inline.
    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toEqual([
      snapshotDigest(shared),
    ]);
    expect(
      column<string>(
        file,
        "SELECT session_id FROM qa_ownership ORDER BY session_id",
      ),
    ).toEqual(["session-a", "session-b", "session-c"]);
    for (const sessionId of ["session-a", "session-b", "session-c"]) {
      expect(accounts.sessionAccess(sessionId)?.capabilitySnapshot).toEqual(
        shared,
      );
    }
  });

  it("keeps distinct policies apart", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-a", { subroleId: "general" });
    accounts.reserveSession(token, "session-b", { subroleId: "general" });
    accounts.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-1"),
    });
    accounts.updateSessionAccess("session-b", {
      capabilitySnapshot: policy("rev-2", ["read", "grep"]),
    });

    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toHaveLength(
      2,
    );
  });

  it("drops a snapshot the moment no chat refers to it", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-a", { subroleId: "general" });
    accounts.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-1"),
    });
    accounts.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-2"),
    });

    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toEqual([
      snapshotDigest(policy("rev-2")),
    ]);
  });

  it("is insensitive to key order in the policy it digests", () => {
    const left = policy("rev-1");
    const reordered = Object.fromEntries(
      Object.entries(left as unknown as Record<string, unknown>).reverse(),
    ) as unknown as QaEffectiveCapabilityPolicy;

    expect(snapshotDigest(reordered)).toBe(snapshotDigest(left));
  });

  it("drops the snapshot of a chat whose record is reclaimed", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-gone", { subroleId: "general" });
    accounts.updateSessionAccess("session-gone", {
      capabilitySnapshot: policy("rev-1"),
    });
    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toHaveLength(
      1,
    );

    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
    accounts.pruneVanishedSessions(() => false, 24);

    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toEqual([]);
  });
});

describe("QA accounts: importing the pre-SQLite file", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A `qa-accounts.json` as a pre-0.8.0 release wrote it. */
  function writeLegacyFile(
    dir: string,
    ownership: Record<string, unknown>,
    snapshots?: Record<string, unknown>,
  ): string {
    const file = path.join(dir, "qa-accounts.json");
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          version: 1,
          secret: "legacy-secret",
          users: [
            {
              id: "user-1",
              email: "op@example.com",
              displayName: "op",
              role: "admin",
              passwordHash: { salt: "00", hash: "00" },
              createdAt: "2026-09-10T00:00:00.000Z",
              lastLoginAt: null,
            },
          ],
          ownership,
          ...(snapshots === undefined ? {} : { snapshots }),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return file;
  }

  function legacyRig(): { dir: string; file: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-legacy-"));
    return { dir, file: path.join(dir, "qa-accounts.db") };
  }

  it("imports the file, resolves its snapshots and renames it aside", () => {
    const { dir, file } = legacyRig();
    const inline = policy("rev-legacy");
    writeLegacyFile(
      dir,
      {
        "session-old": {
          userId: "user-1",
          claimedAt: "2026-09-10T00:00:00.000Z",
          snapshotRef: snapshotDigest(inline),
        },
      },
      { [snapshotDigest(inline)]: inline },
    );

    const accounts = openStore(file);

    expect(accounts.sessionAccess("session-old")?.capabilitySnapshot).toEqual(
      inline,
    );
    expect(column<string>(file, "SELECT id FROM qa_accounts")).toEqual([
      "user-1",
    ]);
    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toEqual([
      snapshotDigest(inline),
    ]);
    // The imported file is retired, not deleted.
    expect(readdirSync(dir).some((name) => name.includes(".migrated-"))).toBe(
      true,
    );
    expect(() =>
      readFileSync(path.join(dir, "qa-accounts.json"), "utf8"),
    ).toThrow();
  });

  it("reads a file that predates snapshot deduplication", () => {
    const { dir, file } = legacyRig();
    const inline = policy("rev-inline");
    // No `snapshots` map at all: every chat carried its own copy.
    writeLegacyFile(dir, {
      "session-a": {
        userId: "user-1",
        claimedAt: "2026-09-10T00:00:00.000Z",
        capabilitySnapshot: inline,
      },
      "session-b": {
        userId: "user-1",
        claimedAt: "2026-09-10T00:00:00.000Z",
        capabilitySnapshot: inline,
      },
    });

    const accounts = openStore(file);

    expect(accounts.sessionAccess("session-a")?.capabilitySnapshot).toEqual(
      inline,
    );
    // Two chats, one stored policy.
    expect(column<string>(file, "SELECT hash FROM qa_snapshots")).toEqual([
      snapshotDigest(inline),
    ]);
  });

  it("refuses a file whose snapshot reference dangles, and keeps the file", () => {
    const { dir, file } = legacyRig();
    writeLegacyFile(dir, {
      "session-a": {
        userId: "user-1",
        claimedAt: "2026-09-10T00:00:00.000Z",
        snapshotRef: "0000000000000000",
      },
    });

    expect(() => openStore(file)).toThrow(/missing capability snapshot/u);
    // The rollback leaves the file in place, imports no account, and hands the
    // operator a database they can retry against once the file is fixed.
    expect(readdirSync(dir)).toContain("qa-accounts.json");
    expect(() =>
      readFileSync(path.join(dir, "qa-accounts.json"), "utf8"),
    ).not.toThrow();
    expect(column<string>(file, "SELECT id FROM qa_accounts")).toEqual([]);
  });

  it("refuses a file it cannot recognize and leaves it in place", () => {
    const { dir, file } = legacyRig();
    const broken = path.join(dir, "qa-accounts.json");
    writeFileSync(broken, '{"version":2,"users":[]}\n', "utf8");

    expect(() => openStore(file)).toThrow(/refusing to import/u);
    expect(readFileSync(broken, "utf8")).toBe('{"version":2,"users":[]}\n');
  });

  it("never overwrites an existing database from a leftover file", () => {
    const { dir, file } = legacyRig();
    const first = openStore(file);
    first.register("current@example.com", "password-1");
    first.close();
    writeLegacyFile(dir, {
      "session-old": {
        userId: "user-1",
        claimedAt: "2026-09-10T00:00:00.000Z",
      },
    });

    const reopened = openStore(file);

    expect(column<string>(file, "SELECT email FROM qa_accounts")).toEqual([
      "current@example.com",
    ]);
    expect(reopened.sessionAccess("session-old")).toBeUndefined();
    // The leftover file stays where it is: dropping it is the operator's call.
    expect(readFileSync(path.join(dir, "qa-accounts.json"), "utf8")).toContain(
      "session-old",
    );
  });

  it("reads a pre-SQLite path given by its old name", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-accounts-oldpath-"));
    const jsonPath = writeLegacyFile(dir, {
      "session-old": {
        userId: "user-1",
        claimedAt: "2026-09-10T00:00:00.000Z",
      },
    });

    // An operator pointing the deployment at the pre-SQLite filename must keep
    // the accounts, not start an empty store over the file.
    const accounts = openStore(jsonPath);

    expect(accounts.filePath).toBe(path.join(dir, "qa-accounts.db"));
    expect(accounts.sessionAccess("session-old")).toBeDefined();
    expect(
      column<string>(accounts.filePath, "SELECT COUNT(*) FROM qa_accounts"),
    ).toEqual([1]);
  });
});

describe("QA accounts: ownership eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops records of chats the Harness no longer knows", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-gone", { subroleId: "general" });
    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));

    const removed = accounts.pruneVanishedSessions(() => false, 24);

    expect(removed).toEqual(["session-gone"]);
    expect(accounts.sessionAccess("session-gone")).toBeUndefined();
    expect(accounts.ownedSessionIds(token)).toEqual([]);
    expect(column<string>(file, "SELECT session_id FROM qa_ownership")).toEqual(
      [],
    );
    // Housekeeping removes the record, not the account.
    expect(column<number>(file, "SELECT COUNT(*) FROM qa_accounts")).toEqual([
      1,
    ]);
  });

  it("keeps a record younger than the grace period", () => {
    const { store: accounts } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-fresh", { subroleId: "general" });
    vi.setSystemTime(new Date("2026-09-11T13:00:00Z"));

    expect(accounts.pruneVanishedSessions(() => false, 24)).toEqual([]);
    expect(accounts.sessionAccess("session-fresh")).toBeDefined();
  });

  it("keeps a record of a chat that still exists, however old", () => {
    const { store: accounts } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-live", { subroleId: "general" });
    vi.setSystemTime(new Date("2027-09-11T12:00:00Z"));

    expect(
      accounts.pruneVanishedSessions((id) => id === "session-live", 24),
    ).toEqual([]);
    expect(accounts.sessionAccess("session-live")).toBeDefined();
  });

  it("changes nothing when nothing is prunable", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-a", { subroleId: "general" });

    expect(
      accounts.pruneVanishedSessions((id) => id === "session-a", 24),
    ).toEqual([]);
    expect(
      column<string>(
        file,
        "SELECT session_id FROM qa_ownership ORDER BY session_id",
      ),
    ).toEqual(["session-a"]);
  });

  it("keeps a record whose claim time cannot be parsed", () => {
    const { store: accounts, file } = rig();
    const { token } = accounts.register("op@example.com", "password-1");
    accounts.reserveSession(token, "session-a", { subroleId: "general" });
    run(
      file,
      "UPDATE qa_ownership SET claimed_at = ? WHERE session_id = ?",
      "not-a-date",
      "session-a",
    );
    vi.setSystemTime(new Date("2027-09-11T12:00:00Z"));

    const reopened = openStore(file);

    expect(reopened.pruneVanishedSessions(() => false, 24)).toEqual([]);
  });
});
