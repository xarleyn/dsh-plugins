import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";

describe("QA chat index and switching", () => {
  it("indexes each attested chat for this browser", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    // A visit that sends nothing is not a chat: the index fills with the prompt.
    expect(controller.chatIds()).toEqual([]);
    expect(await controller.send("Первый вопрос")).toBe(true);
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
    expect(await controller.send("Первый вопрос")).toBe(true);
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
    expect(controller.chatIds()).toEqual(["saved"]);
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
    // A chat the stand would not vouch for is not written into the history.
    expect(controller.chatIds()).toEqual([]);
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
    expect(world.retain).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().sessionId).toBe("saved");
    controller.dispose();
  });

  it("returns from a subagent to the configured chat with a fresh attestation", async () => {
    const world = harness(["saved", "child", "other"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { policy: "fixed", fixedSessionId: "saved" },
      }),
    });
    try {
      await controller.ensureSession();
      await controller.viewSubagent("child", "Demo");
      await controller.switchTo("other");
      expect(controller.getSnapshot()).toMatchObject({
        sessionId: "child",
        canSend: false,
      });
      const previous = world.secureSession.mock.calls.length;
      await controller.closeSubagent();
      expect(controller.getSnapshot()).toMatchObject({
        sessionId: "saved",
        viewingSubagent: null,
        canSend: true,
      });
      expect(world.secureSession).toHaveBeenCalledTimes(previous + 1);
      expect(world.faces.get("child")?.prompt).not.toHaveBeenCalled();
      expect(world.stored.has("dsh-qa-surface.session:v1:/qa:session")).toBe(
        false,
      );
    } finally {
      controller.dispose();
    }
  });
});
