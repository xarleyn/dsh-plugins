import { describe, expect, it } from "vitest";
import { staticSessionLogReader } from "../../src/admin/session-log.js";
import { harness } from "./access-service.helpers.js";

describe("branch ownership retention", () => {
  it("does not reclaim an ordinary fork as a delegated session", async () => {
    const world = harness({ sessionLog: staticSessionLogReader({ sessions: [
      { id: "parent", createdAt: 1 },
      { id: "branch", createdAt: 2, parentSessionId: "parent", isFork: true },
      { id: "expert", createdAt: 3, parentSessionId: "branch" },
    ] }) });
    world.accounts.reserveSession(world.user.token, "branch");
    world.accounts.reserveSession(world.user.token, "expert");
    await world.service.reclaimDelegatedSessions();
    expect(world.accounts.ownedSessionIds(world.user.token)).toEqual(["branch"]);
    expect(world.service.isDelegatedChild("branch")).toBe(false);
    expect(world.service.isDelegatedChild("expert")).toBe(true);
  });
});
