import { describe, expect, it } from "vitest";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { resolveConfig } from "../../src/resolve-config.js";
import { harness } from "../helpers/session-fakes.js";

function draftWithQueueRead() {
  const world = harness(["saved"]);
  let resume!: () => void;
  const queue = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig({ session: { maxActiveRequests: 1 } }),
    queueStatus: async () => {
      await queue;
      return { ok: true, value: { limit: 1, active: 0, full: false } };
    },
  });
  return { world, controller, resume };
}

describe("a draft waiting for a queue slot", () => {
  it.each(["history", "role"] as const)(
    "cancels its send after a change of %s",
    async (navigation) => {
      const { world, controller, resume } = draftWithQueueRead();
      try {
        await controller.ensureSession();
        const sending = controller.send("Draft question");
        if (navigation === "history") await controller.switchTo("saved");
        else await controller.selectSubrole("demo-role");
        resume();
        expect(await sending).toBe(false);
        expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
        expect(world.createSession).not.toHaveBeenCalled();
        expect(controller.getSnapshot()).toMatchObject({
          canSend: true,
          pendingMessage: null,
          requestQueue: null,
          error: null,
        });
      } finally {
        controller.dispose();
      }
    },
  );

  it("keeps the question when its own draft acquires a session", async () => {
    const { world, controller, resume } = draftWithQueueRead();
    try {
      await controller.ensureSession();
      const sending = controller.send("Draft question");
      await controller.retrySession();
      const id = controller.activeSessionId();
      resume();
      expect(await sending).toBe(true);
      expect(world.createSession).toHaveBeenCalledOnce();
      expect(world.faces.get(String(id))?.prompt).toHaveBeenCalledWith(
        [{ type: "text", text: "Draft question" }],
        "queue",
      );
    } finally {
      controller.dispose();
    }
  });
});

describe("opening chat history", () => {
  it("does not create an abandoned draft when its connection is ready", async () => {
    const world = harness(["saved"]);
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    try {
      await controller.ensureSession();
      const sending = controller.send("Draft question");
      await controller.switchTo("saved");
      expect(await sending).toBe(false);
      expect(world.createSession).not.toHaveBeenCalled();
      expect(controller.activeSessionId()).toBe("saved");
    } finally {
      controller.dispose();
    }
  });

  it("keeps the chosen chat when a stale startup bookmark is absent from the catalog", async () => {
    const world = harness(["saved"]);
    const ready = world.list.getSnapshot();
    world.list.set({ ...ready, phase: "pending" });
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "gone");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    try {
      const restoring = controller.ensureSession();
      const switching = controller.switchTo("saved");
      world.list.set(ready);
      await Promise.all([restoring, switching]);
      expect(controller.activeSessionId()).toBe("saved");
      expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
        "saved",
      );
    } finally {
      controller.dispose();
    }
  });
});
