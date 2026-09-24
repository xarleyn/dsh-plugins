import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotDigest } from "../../src/accounts/file.js";
import { column, openStore, policy } from "./accounts-retention.helpers.js";

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
