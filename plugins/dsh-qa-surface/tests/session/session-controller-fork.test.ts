import { describe, expect, it, vi } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness } from "../helpers/session-fakes.js";

describe("branch navigation", () => {
  it("adopts a server-created branch even before its catalog row arrives", async () => {
    const w = harness(["parent"]);
    const forkSession = vi.fn(async () => ({
      ok: true as const,
      value: await w.serverSession(),
    }));
    const controller = new QaSessionController({
      ...w,
      forkSession,
      config: resolveConfig(),
    });
    await controller.switchTo("parent");
    const original = w.faces.get("parent");
    await controller.forkFromAnswer(12);
    expect(forkSession).toHaveBeenCalledWith("", "parent", 12);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "created-2",
      phase: "ready",
      canSend: true,
    });
    expect(w.secureSession).toHaveBeenLastCalledWith("", "created-2");
    expect(original?.prompt).not.toHaveBeenCalled();
    expect(original?.cancel).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("deduplicates concurrent clicks and does not steal navigation after a slow response", async () => {
    const w = harness(["parent", "other"]);
    let settle: (value: { ok: true; value: string }) => void = () => {};
    const forkSession = vi.fn(
      () =>
        new Promise<{ ok: true; value: string }>((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new QaSessionController({
      ...w,
      forkSession,
      config: resolveConfig(),
    });
    await controller.switchTo("parent");
    const pending = controller.forkFromAnswer(12);
    await controller.forkFromAnswer(12);
    expect(forkSession).toHaveBeenCalledTimes(1);
    await controller.switchTo("other");
    const child = await w.serverSession();
    settle({ ok: true, value: child });
    await pending;
    expect(controller.getSnapshot().sessionId).toBe("other");
    expect(w.secureSession).not.toHaveBeenCalledWith("", child);
    controller.dispose();
  });
  it("keeps the source chat when the Host refuses the branch", async () => {
    const w = harness(["parent"]);
    const controller = new QaSessionController({
      ...w,
      config: resolveConfig(),
      forkSession: async () => ({ ok: false, error: { code: "denied" } }),
    });
    await controller.switchTo("parent");
    await controller.forkFromAnswer(12);
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "parent",
      error: "Не удалось создать ветку чата.",
    });
    controller.dispose();
  });
  it("opens and restores an ordinary native child in chat history", async () => {
    const w = harness(["parent", "branch"]);
    const list = w.list.getSnapshot();
    w.list.set({
      ...list,
      byId: {
        ...list.byId,
        branch: { ...list.byId["branch" as never], parentId: "parent" },
      },
    } as never);
    const controller = new QaSessionController({
      ...w,
      config: resolveConfig(),
    });
    await controller.switchTo("branch");
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: "branch",
      canSend: true,
    });
    controller.dispose();
    const restored = new QaSessionController({ ...w, config: resolveConfig() });
    await restored.ensureSession();
    expect(restored.getSnapshot().sessionId).toBe("branch");
    restored.dispose();
  });
});
