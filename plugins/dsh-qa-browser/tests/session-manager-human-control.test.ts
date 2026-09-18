import { describe, expect, it } from "vitest";

import { createHarness } from "./session-manager.helpers.js";

describe("QaBrowserSessionManager", () => {
  it("leases human control, blocks agent mutations, and expires safely", async () => {
    let now = 10_000;
    const { config, manager, provider } = createHarness({ now: () => now });
    const session = await manager.ensureSession("takeover");
    const tabId = session.selectedTabId!;

    expect(manager.acquireHumanControl("takeover", "client-a").control).toEqual(
      {
        owner: "human",
        clientId: "client-a",
        leaseExpiresAt: now + config.humanControl.leaseMs,
      },
    );
    await expect(
      manager.navigate("takeover", tabId, { url: "https://one.example" }),
    ).rejects.toMatchObject({ code: "BROWSER_HUMAN_CONTROL_ACTIVE" });
    await expect(manager.snapshot("takeover", tabId)).resolves.toMatchObject({
      tabId,
    });
    await expect(manager.screenshot("takeover", tabId)).resolves.toEqual(
      Buffer.from("fake-png"),
    );
    await expect(
      manager.humanPointer("takeover", tabId, "client-a", {
        action: "click",
        x: 720,
        y: 450,
      }),
    ).resolves.toMatchObject({ ok: true });
    const page = [...provider.contexts.values()][0]!.pages[0]!;
    expect(page.pointerActions).toEqual([{ action: "click", x: 720, y: 450 }]);

    now += config.humanControl.leaseMs - 1;
    expect(
      manager.heartbeatHumanControl("takeover", "client-a").control,
    ).toMatchObject({ leaseExpiresAt: now + config.humanControl.leaseMs });
    await expect(
      manager.humanPointer("takeover", tabId, "client-a", {
        action: "click",
        x: 1440,
        y: 0,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_ACTION_FAILED" });

    now += config.humanControl.leaseMs;
    expect(manager.getSession("takeover")?.control).toEqual({
      owner: "agent",
      leaseExpiresAt: null,
    });
    await expect(
      manager.navigate("takeover", tabId, { url: "https://two.example" }),
    ).resolves.toMatchObject({ ok: true });
    await manager.dispose();
  });

  it("rejects competing human clients and releases only for the owner", async () => {
    const { manager } = createHarness();
    await manager.ensureSession("owners");
    manager.acquireHumanControl("owners", "client-a");
    expect(() =>
      manager.acquireHumanControl("owners", "client-b"),
    ).toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_ACTIVE" }),
    );
    expect(() =>
      manager.releaseHumanControl("owners", "client-b"),
    ).toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );
    expect(manager.releaseHumanControl("owners", "client-a").control).toEqual({
      owner: "agent",
      leaseExpiresAt: null,
    });
    await manager.dispose();
  });
});
