import type { ScopeKey } from "@deepseek-ai/dsh-scope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, reader } from "./access-service.helpers.js";
describe("QA access service: the vanished-chat sweep", () => {
  /** The tightest retention the resolver allows; the clock then passes it. */
  const retention = { ownershipGraceHours: 1, sweepIntervalMinutes: 1 };

  /** Two hours on: past the grace period and past the throttle window. */
  const later = (): void => {
    vi.setSystemTime(new Date("2026-09-18T11:00:00Z"));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the record of a chat only storage still knows", async () => {
    // Nobody has opened this chat since the restart, so the live store is
    // silent about it — but storage holds it, and a quiet chat is not a
    // deleted one. A sweep that asked the live store alone would drop it.
    const { service, accounts, user } = harness({
      sessionLog: reader([{ id: "session-cold", createdAt: 1 }]),
      retention,
    });
    accounts.reserveSession(user.token, "session-cold", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-cold"]);
  });

  it("reclaims the record of a chat the whole Harness lost, and reports it", async () => {
    const vanished: string[][] = [];
    const { service, accounts, user } = harness({
      sessionLog: reader([]),
      retention,
      onVanishedSessions: (sessionIds) => vanished.push([...sessionIds]),
    });
    accounts.reserveSession(user.token, "session-gone", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    expect(accounts.ownedSessionIds(user.token)).toEqual([]);
    // The record is the auth boundary; what else the deployment kept about the
    // chat is the caller's to drop, and it is told exactly which ids.
    expect(vanished).toEqual([["session-gone"]]);
  });

  it("reclaims nothing against a listing that cannot see stored sessions", async () => {
    const { service, accounts, user } = harness({
      sessionLog: {
        live: () => false,
        list: async () => ({ headers: [], complete: false }),
        read: async () => ({
          ok: false as const,
          reason: "storage-unavailable",
        }),
      },
      retention,
    });
    accounts.reserveSession(user.token, "session-quiet", {
      subroleId: "general",
    });
    later();

    await service.sweepVanishedOwnership();

    // An incomplete listing is an unanswerable question, not a deletion.
    expect(accounts.ownedSessionIds(user.token)).toEqual(["session-quiet"]);
  });
});

describe("the admin catalog's viewing scope", () => {
  it("reads skills and tools in the QA preset's scope", async () => {
    // A kit's skill catalog and the preset's tool family are mounted in the
    // preset's scope; a global-only read showed an administrator almost
    // nothing to grant.
    const presetScope = async (): Promise<ScopeKey | undefined> => ({
      agentPreset: "qa-research",
    });
    const { service, admin } = harness({ presetScope });

    const snapshot = await service.adminSnapshot(admin.token);

    const skillIds = snapshot.catalog
      .filter(({ type }) => type === "skill")
      .map(({ id }) => id);
    expect(skillIds).toContain("preset-search");
    const toolIds = snapshot.catalog
      .filter(({ type }) => type === "tool")
      .map(({ id }) => id);
    expect(toolIds).toContain("preset_tool");
  });

  it("stays global when no preset scope is resolved", async () => {
    const { service, admin } = harness();

    const snapshot = await service.adminSnapshot(admin.token);

    const ids = snapshot.catalog.map(({ id }) => id);
    expect(ids).not.toContain("preset-search");
    expect(ids).not.toContain("preset_tool");
  });

  it("degrades to the global view when the preset cannot be composed", async () => {
    const { service, admin } = harness({
      presetScope: async () => {
        throw new Error("preset composition is unreadable");
      },
    });

    const snapshot = await service.adminSnapshot(admin.token);

    const ids = snapshot.catalog.map(({ id }) => id);
    expect(ids).not.toContain("preset-search");
    expect(ids).toContain("company");
  });
});
