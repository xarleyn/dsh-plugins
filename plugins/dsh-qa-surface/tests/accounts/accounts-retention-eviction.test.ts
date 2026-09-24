import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { column, openStore, rig, run } from "./accounts-retention.helpers.js";

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
