import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";

describe("QA session controller", () => {
  it("refuses a delegated child as a chat and drops it from the index", async () => {
    // A subagent's session is not a chat. An older release could leave one in
    // this browser's index (a subagent transcript opened as a chat and
    // persisted as the open one); opening it must forget it instead.
    const world = harness([], { subagents: ["sub-1"] });
    world.stored.set(
      "dsh-qa-surface.session:v1:/qa:chats",
      JSON.stringify(["sub-1"]),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.switchTo("sub-1");

    expect(world.open).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      error: "Не удалось открыть этот чат.",
    });
    expect(controller.chatIds()).toEqual([]);
    controller.dispose();
  });

  it("never restores a delegated child as the open chat", async () => {
    const world = harness([], { subagents: ["sub-1"] });
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "sub-1");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(world.open).not.toHaveBeenCalledWith("sub-1");
    expect(world.create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().sessionId).toMatch(/^created-/u);
    controller.dispose();
  });

  it("ignores a stored id that only exists on the prototype", async () => {
    // The persisted id is browser storage: reading it must stay a property
    // check, not a lookup that `__proto__` satisfies.
    const world = harness();
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "__proto__");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(world.open).not.toHaveBeenCalledWith("__proto__");
    expect(world.create).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
