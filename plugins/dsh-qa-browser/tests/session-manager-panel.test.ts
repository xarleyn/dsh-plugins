import { describe, expect, it, vi } from "vitest";

import { createHarness } from "./session-manager.helpers.js";

describe("QaBrowserSessionManager", () => {
  it("counts the pages a tab visited and walks them back and forward", async () => {
    const { manager } = createHarness();
    const session = await manager.ensureSession("history");
    const tabId = session.tabIds[0] ?? "";
    await manager.navigate("history", tabId, { url: "https://one.example/" });
    await manager.navigate("history", tabId, { url: "https://two.example/" });

    const depth = async () =>
      (await manager.listPanelTabs("history")).find((tab) => tab.id === tabId);
    // The first entry is the blank page the tab opened on, so two navigations
    // leave two pages behind the current one.
    expect((await depth())?.history).toEqual({ back: 2, forward: 0 });

    await manager.history("history", tabId, "back");
    expect((await depth())?.history).toEqual({ back: 1, forward: 1 });
    expect((await depth())?.url).toBe("https://one.example/");

    await manager.history("history", tabId, "forward");
    expect((await depth())?.history).toEqual({ back: 2, forward: 0 });
    expect((await depth())?.url).toBe("https://two.example/");

    // Reload keeps the position, so neither arrow claims a new page.
    await manager.history("history", tabId, "reload");
    expect((await depth())?.history).toEqual({ back: 2, forward: 0 });
    await manager.dispose();
  });

  it("records a page that moved on its own as a new entry", async () => {
    const { manager, provider } = createHarness();
    const session = await manager.ensureSession("links");
    const tabId = session.tabIds[0] ?? "";
    await manager.navigate("links", tabId, { url: "https://one.example/" });
    const page = [...provider.contexts.values()][0]?.pages[0];
    page?.followLink("https://two.example/deep");

    const depth = async () =>
      (await manager.listPanelTabs("links")).find((tab) => tab.id === tabId);
    await vi.waitFor(async () => {
      expect((await depth())?.history).toEqual({ back: 2, forward: 0 });
    });

    // Going back from a page the runtime merely watched still lands where the
    // browser says it landed, and the depth follows it.
    await manager.history("links", tabId, "back");
    expect((await depth())?.url).toBe("https://one.example/");
    expect((await depth())?.history).toEqual({ back: 1, forward: 1 });
    await manager.dispose();
  });

  it("keeps the panel's own tab work behind the lease", async () => {
    const { manager } = createHarness({ maxTabs: 2 });
    await manager.ensureSession("lease");
    const selected = manager.getSession("lease")?.selectedTabId ?? "";

    await expect(manager.humanNewTab("lease", "client-a")).rejects.toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );
    await expect(
      manager.humanCloseTab("lease", selected, "client-a"),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );
    await expect(
      manager.humanHistory("lease", selected, "client-a", "reload"),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );
    await expect(
      manager.humanSetViewport("lease", selected, "client-a", {
        width: 800,
        height: 600,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "BROWSER_HUMAN_CONTROL_NOT_OWNER" }),
    );

    manager.acquireHumanControl("lease", "client-a");
    const opened = await manager.humanNewTab("lease", "client-a");
    expect(opened.summary).toContain("opened");
    expect(manager.getSession("lease")?.selectedTabId).toBe(opened.tabId);
    // The deployment's tab limit is the panel's limit too.
    await expect(manager.humanNewTab("lease", "client-a")).rejects.toThrowError(
      expect.objectContaining({ code: "BROWSER_TOO_MANY_TABS" }),
    );

    await manager.humanCloseTab("lease", opened.tabId, "client-a");
    expect(manager.getSession("lease")?.tabIds.includes(opened.tabId)).toBe(
      false,
    );
    await manager.dispose();
  });

  it("clamps the panel's device sizes to the deployment's bounds", async () => {
    const { manager, provider } = createHarness();
    await manager.ensureSession("device");
    const tab = manager.getSession("device")?.selectedTabId ?? "";
    manager.acquireHumanControl("device", "client-a");
    await manager.humanSetViewport("device", tab, "client-a", {
      width: 99_999,
      height: 10,
    });

    const page = [...provider.contexts.values()][0]?.pages[0];
    expect(page?.viewports).toEqual([
      { width: 7_680, height: 240, deviceScaleFactor: 1 },
    ]);
    expect((await manager.listPanelTabs("device"))[0]?.viewport).toEqual({
      width: 7_680,
      height: 240,
      deviceScaleFactor: 1,
    });
    await manager.dispose();
  });
});
