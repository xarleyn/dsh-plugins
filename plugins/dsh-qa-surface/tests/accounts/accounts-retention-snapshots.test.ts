import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { snapshotDigest } from "../../src/accounts/file.js";
import type { QaEffectiveCapabilityPolicy } from "../../src/types.js";
import { column, policy, rig } from "./accounts-retention.helpers.js";

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
