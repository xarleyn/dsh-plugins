import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";

const local = { provider: "local", model: "small" };
describe("chat-local model selection", () => {
  it("materializes a draft only on an explicit selection without sending a prompt or replacing the chat", async () => {
    const world = harness();
    const select = vi.spyOn(world.api, "selectModel");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const key = controller.getSnapshot().chatKey;
    expect(world.createSession).not.toHaveBeenCalled();
    const id = await controller.selectModel(local);
    expect(world.createSession).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().chatKey).toBe(key);
    expect(select).toHaveBeenCalledExactlyOnceWith({ sessionId: id, ...local });
    expect(world.faces.get(id)?.prompt).not.toHaveBeenCalled();
    await controller.selectModel({ provider: "deepseek", model: "chat" });
    expect(world.createSession).toHaveBeenCalledOnce();
    expect(controller.activeSessionId()).toBe(id);
    controller.dispose();
  });
  it("reports a rejected selection and preserves the opened chat", async () => {
    const world = harness();
    vi.spyOn(world.api, "selectModel").mockResolvedValueOnce({
      ok: false,
      error: { code: "gateway/internal", message: "Denied" },
    } as never);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await expect(controller.selectModel(local)).rejects.toThrow(
      /сменить модель/u,
    );
    expect(controller.activeSessionId()).not.toBeNull();
    expect(world.createSession).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
