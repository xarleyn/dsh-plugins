import { describe, expect, it } from "vitest";

import { QaBrowserError } from "../src/errors.js";

import { createHarness, type FakeContext } from "./session-manager.helpers.js";

describe("QaBrowserSessionManager", () => {
  it("creates one isolated context per DSH session and keeps independent tabs", async () => {
    const { manager, provider } = createHarness();
    const [left, right] = await Promise.all([
      manager.ensureSession("session-a"),
      manager.ensureSession("session-b"),
    ]);
    expect(provider.contexts.size).toBe(2);
    expect(left.tabIds).toHaveLength(1);
    expect(right.tabIds).toHaveLength(1);
    expect(left.tabIds[0]).not.toBe(right.tabIds[0]);

    await manager.newTab("session-a");
    expect(await manager.listTabs("session-a")).toHaveLength(2);
    expect(await manager.listTabs("session-b")).toHaveLength(1);
    await manager.dispose();
  });

  it("coalesces concurrent creation and serializes mutations on one tab", async () => {
    const { manager, provider } = createHarness();
    const sessions = await Promise.all([
      manager.ensureSession("same"),
      manager.ensureSession("same"),
      manager.ensureSession("same"),
    ]);
    expect(provider.contexts.size).toBe(1);
    const tabId = sessions[0]?.selectedTabId;
    expect(tabId).toBeTruthy();
    await Promise.all([
      manager.navigate("same", tabId!, { url: "https://one.example" }),
      manager.navigate("same", tabId!, { url: "https://two.example" }),
    ]);
    const page = [...provider.contexts.values()][0]?.pages[0];
    expect(page?.navigations).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
    expect(page?.maxActiveNavigations).toBe(1);
    await manager.dispose();
  });

  it("enforces tab limits and closes idle contexts", async () => {
    let now = 1_000;
    const { config, manager, provider } = createHarness({
      now: () => now,
      maxTabs: 1,
    });
    await manager.ensureSession("idle");
    await expect(manager.newTab("idle")).rejects.toMatchObject({
      code: "BROWSER_TOO_MANY_TABS",
    } satisfies Partial<QaBrowserError>);
    now += config.runtime.idleTimeoutMs;
    await expect(manager.closeIdleSessions()).resolves.toBe(1);
    expect(manager.getSession("idle")).toBeNull();
    expect(provider.contexts.size).toBe(0);
    await manager.dispose();
  });

  it("marks state lost on crash and recreates the context on the next ensure", async () => {
    const { manager, provider } = createHarness();
    await manager.ensureSession("crash");
    provider.crash();
    expect(manager.getSession("crash")).toMatchObject({
      status: "crashed",
      selectedTabId: null,
      tabIds: [],
    });
    await manager.ensureSession("crash");
    expect(manager.getSession("crash")?.status).toBe("ready");
    await manager.dispose();
  });

  it("closes a session whose creation was still running when it disposed", async () => {
    const { manager, provider } = createHarness();
    // A creation the disposal has to join: the context it registers is not in
    // the session map while it is being built, so a sweep that reads the map
    // first would stop the provider and leave the session running behind it.
    let openBuild: () => void = () => undefined;
    const build = new Promise<void>((resolve) => {
      openBuild = () => resolve();
    });
    const buildContext = provider.createContext.bind(provider);
    const built: FakeContext[] = [];
    provider.createContext = async (options) => {
      await build;
      const context = await buildContext(options);
      built.push(context);
      return context;
    };

    const creating = manager.ensureSession("late");
    // The disposal has to be joined, not awaited after the creation: the point
    // is that the two are running at the same time.
    const disposing = manager.dispose();
    openBuild();
    await creating;
    await disposing;

    expect(built).toHaveLength(1);
    expect(built[0]?.closed).toBe(true);
    expect(provider.stops).toBe(1);
    expect(manager.getSession("late")).toBeNull();
  });

  it("passes the configured runtime mode down to the provider", async () => {
    const { manager, provider } = createHarness({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });

    await manager.ensureSession("attached");

    expect(provider.startOptions.at(-1)).toMatchObject({
      mode: "attach",
      cdpEndpoint: "http://127.0.0.1:9222",
    });
    await manager.dispose();
  });

  it("keeps a dropped CDP link apart from a crash and re-attaches on the next ensure", async () => {
    const { manager, provider } = createHarness({
      runtime: { mode: "attach", cdpEndpoint: "http://127.0.0.1:9222" },
    });
    const session = await manager.ensureSession("attached");
    const tabId = session.selectedTabId!;

    provider.crash("BROWSER_CONNECTION_LOST");

    // The browser a person started is likely still running; only our link to it
    // is gone, and the panel is told that rather than a crash it cannot verify.
    expect(manager.getSession("attached")).toMatchObject({
      status: "disconnected",
      selectedTabId: null,
      tabIds: [],
    });
    await expect(manager.snapshot("attached", tabId)).rejects.toMatchObject({
      code: "BROWSER_CONNECTION_LOST",
    });
    await manager.ensureSession("attached");
    expect(manager.getSession("attached")?.status).toBe("ready");
    expect(provider.starts).toBe(2);
    await manager.dispose();
  });

  it("binds semantic refs to a revision and refuses stale actions", async () => {
    const { manager } = createHarness();
    const session = await manager.ensureSession("semantic");
    const tabId = session.selectedTabId!;
    const snapshot = await manager.snapshot("semantic", tabId);
    expect(snapshot.text).toContain('[e1] textbox "Email"');
    await expect(
      manager.type("semantic", tabId, "e1", "secret"),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(manager.click("semantic", tabId, "e2")).rejects.toMatchObject({
      code: "BROWSER_STALE_REF",
    });
    await manager.dispose();
  });
});
