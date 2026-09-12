import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { harness } from "./helpers/session-fakes.js";

describe("QA chat index and switching", () => {
  it("indexes each attested chat for this browser", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.chatIds()).toEqual(["created-1"]);
    expect(
      JSON.parse(
        world.stored.get("dsh-qa-surface.session:v1:/qa:chats") ?? "[]",
      ),
    ).toEqual(["created-1"]);
    controller.dispose();
  });

  it("switches to an indexed chat and re-attests it", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-2");
    await controller.switchTo("saved");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "saved",
      canSend: true,
    });
    expect(controller.activeSessionId()).toBe("saved");
    expect(controller.chatIds()).toEqual(["saved", "created-2"]);
    expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "saved",
    );
    controller.dispose();
  });

  it("forgets and reports a chat the host no longer lists", async () => {
    const world = harness(["saved"]);
    world.stored.set(
      "dsh-qa-surface.session:v1:/qa:chats",
      JSON.stringify(["gone", "saved"]),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await controller.switchTo("gone");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Не удалось открыть этот чат.",
    });
    expect(controller.chatIds()).toEqual(["created-2", "saved"]);
    controller.dispose();
  });

  it("surfaces an attestation failure without dropping the chat", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    world.secureSession.mockRejectedValueOnce(new Error("fence"));
    await controller.switchTo("saved");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Настройки помощника недоступны.",
    });
    expect(controller.chatIds()).toEqual(["created-2"]);
    controller.dispose();
  });

  it("caps and cleans the stored chat index", () => {
    const world = harness();
    const junk = Array.from({ length: 60 }, (_, i) => `chat-${i}`);
    world.stored.set(
      "dsh-qa-surface.session:v1:/qa:chats",
      JSON.stringify(["chat-3", 42, null, "chat-3", ...junk]),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const ids = controller.chatIds();
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids[0]).toBe("chat-3");
    expect(new Set(ids).size).toBe(ids.length);
    controller.dispose();
  });

  it("ignores switching under a fixed session policy", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "fixed", fixedSessionId: "saved" },
      }),
    });
    await controller.ensureSession();
    await controller.switchTo("not-in-the-list");
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().sessionId).toBe("saved");
    controller.dispose();
  });
});
