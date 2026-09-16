import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const file = path.join(dir, "qa-accounts.json");
  return {
    file,
    store: new QaAccounts(file, {
      sessionTtlDays: 30,
      allowRegistration: true,
      maxAuthAttemptsPerMinute: 100,
    }),
  };
}

/** The accounts file as it rests on disk. */
function onDisk(file: string): {
  ownership: Record<string, { snapshotRef?: string }>;
  snapshots?: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(file, "utf8")) as never;
}

describe("QA accounts: capability snapshot deduplication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one copy of a policy shared by many chats", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    const shared = policy("rev-1");
    for (const sessionId of ["session-a", "session-b", "session-c"]) {
      store.reserveSession(token, sessionId, { subroleId: "general" });
      store.updateSessionAccess(sessionId, { capabilitySnapshot: shared });
    }

    const stored = onDisk(file);
    expect(Object.keys(stored.snapshots ?? {})).toEqual([
      snapshotDigest(shared),
    ]);
    for (const sessionId of ["session-a", "session-b", "session-c"]) {
      expect(stored.ownership[sessionId]?.snapshotRef).toBe(
        snapshotDigest(shared),
      );
      // The read model is unchanged: callers still get the snapshot inline.
      expect(store.sessionAccess(sessionId)?.capabilitySnapshot).toEqual(
        shared,
      );
    }
  });

  it("keeps distinct policies apart", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-a", { subroleId: "general" });
    store.reserveSession(token, "session-b", { subroleId: "general" });
    store.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-1"),
    });
    store.updateSessionAccess("session-b", {
      capabilitySnapshot: policy("rev-2", ["read", "grep"]),
    });

    expect(Object.keys(onDisk(file).snapshots ?? {})).toHaveLength(2);
  });

  it("drops a snapshot the moment no chat refers to it", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-a", { subroleId: "general" });
    store.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-1"),
    });
    store.updateSessionAccess("session-a", {
      capabilitySnapshot: policy("rev-2"),
    });

    expect(Object.keys(onDisk(file).snapshots ?? {})).toEqual([
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

  it("reads a file written before dedup and dedupes it on the next write", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    const inline = policy("rev-legacy");
    // A file from a build that copied the snapshot into every chat.
    const legacy = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    legacy.ownership = {
      "session-old": {
        userId: "someone",
        claimedAt: "2026-09-10T00:00:00.000Z",
        capabilitySnapshot: inline,
      },
    };
    writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const reopened = new QaAccounts(file, {
      sessionTtlDays: 30,
      allowRegistration: true,
      maxAuthAttemptsPerMinute: 100,
    });
    expect(reopened.sessionAccess("session-old")?.capabilitySnapshot).toEqual(
      inline,
    );

    // Any mutation persists the deduplicated shape.
    reopened.reserveSession(token, "session-new", { subroleId: "general" });
    const stored = onDisk(file);
    expect(Object.keys(stored.snapshots ?? {})).toEqual([
      snapshotDigest(inline),
    ]);
    expect(stored.ownership["session-old"]?.snapshotRef).toBe(
      snapshotDigest(inline),
    );
  });

  it("refuses a file whose snapshot reference dangles", () => {
    const { store, file } = rig();
    store.register("op@example.com", "password-1");
    const broken = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    broken.ownership = {
      "session-a": {
        userId: "u",
        claimedAt: "2026-09-10T00:00:00.000Z",
        snapshotRef: "0000000000000000",
      },
    };
    writeFileSync(file, `${JSON.stringify(broken, null, 2)}\n`, "utf8");

    expect(
      () =>
        new QaAccounts(file, {
          sessionTtlDays: 30,
          allowRegistration: true,
        }),
    ).toThrow(/missing capability snapshot/u);
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
    const { store } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-gone", { subroleId: "general" });
    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));

    const removed = store.pruneVanishedSessions(() => false, 24);

    expect(removed).toEqual(["session-gone"]);
    expect(store.sessionAccess("session-gone")).toBeUndefined();
    expect(store.ownedSessionIds(token)).toEqual([]);
  });

  it("keeps a record younger than the grace period", () => {
    const { store } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-fresh", { subroleId: "general" });
    vi.setSystemTime(new Date("2026-09-11T13:00:00Z"));

    expect(store.pruneVanishedSessions(() => false, 24)).toEqual([]);
    expect(store.sessionAccess("session-fresh")).toBeDefined();
  });

  it("keeps a record of a chat that still exists, however old", () => {
    const { store } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-live", { subroleId: "general" });
    vi.setSystemTime(new Date("2027-09-11T12:00:00Z"));

    expect(
      store.pruneVanishedSessions((id) => id === "session-live", 24),
    ).toEqual([]);
    expect(store.sessionAccess("session-live")).toBeDefined();
  });

  it("leaves the file untouched when nothing is prunable", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-a", { subroleId: "general" });
    const before = readFileSync(file, "utf8");
    const stamp = JSON.parse(before) as unknown;

    expect(store.pruneVanishedSessions((id) => id === "session-a", 24)).toEqual(
      [],
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(stamp);
  });

  it("keeps a record whose claim time cannot be parsed", () => {
    const { store, file } = rig();
    const { token } = store.register("op@example.com", "password-1");
    store.reserveSession(token, "session-a", { subroleId: "general" });
    const broken = JSON.parse(readFileSync(file, "utf8")) as {
      ownership: Record<string, { claimedAt: string }>;
    };
    (broken.ownership["session-a"] as { claimedAt: string }).claimedAt =
      "not-a-date";
    writeFileSync(file, `${JSON.stringify(broken)}\n`, "utf8");
    vi.setSystemTime(new Date("2027-09-11T12:00:00Z"));

    const reopened = new QaAccounts(file, {
      sessionTtlDays: 30,
      allowRegistration: true,
      maxAuthAttemptsPerMinute: 100,
    });
    expect(reopened.pruneVanishedSessions(() => false, 24)).toEqual([]);
  });
});
