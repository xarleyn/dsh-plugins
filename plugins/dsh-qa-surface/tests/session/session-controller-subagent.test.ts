import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { QA_REGENERATE_MARKER } from "../../src/client/QaTranscriptAdapter.js";
import {
  harness,
  sessionFace,
  conversationBinding,
} from "../helpers/session-fakes.js";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";

describe("QA session controller", () => {
  it("watches a subagent read-only and returns to the chat", async () => {
    const world = harness(["chat-1"]);
    // A subagent child of the chat, known to the host session list.
    const childFace = sessionFace("child-1");
    world.faces.set("child-1", childFace);
    world.bindings.set("child-1", conversationBinding("child-1"));
    const list = world.list.getSnapshot();
    world.list.set({
      ...list,
      byId: {
        ...list.byId,
        "child-1": {
          id: "child-1",
          displayTitle: "Print a greeting",
          running: true,
          blank: false,
          updatedAt: 5,
        },
      } as SessionListState["byId"],
    });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const chatId = controller.getSnapshot().sessionId;
    expect(chatId).toBe("created-2");
    const secureCallsBefore = world.secureSession.mock.calls.length;

    await controller.viewSubagent("child-1", "Print a greeting");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "child-1",
      canSend: false,
      viewingSubagent: { id: "child-1", title: "Print a greeting" },
    });
    expect(childFace?.prompt).not.toHaveBeenCalled();

    await controller.closeSubagent();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-2",
      canSend: true,
      viewingSubagent: null,
    });
    // The subagent bind skipped attestation entirely; returning attests.
    expect(world.secureSession.mock.calls.length).toBe(secureCallsBefore + 1);
    controller.dispose();
  });

  it("does not send the pinned cwd through browser session creation", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ session: { cwd: "D:/qa-docs" } }),
    });
    await controller.ensureSession();
    expect(world.createSession).toHaveBeenCalledWith("", null, false);
    expect(world.create).toHaveBeenCalledWith();
    controller.dispose();
  });

  it("starts a new session when the active subrole changes", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      initialSubrole: "analyst",
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(world.createSession).toHaveBeenLastCalledWith("", "analyst", false);
    const first = controller.activeSessionId();

    await controller.selectSubrole("developer");
    expect(controller.activeSessionId()).toBeNull();
    await controller.send("Новый контекст роли", []);

    expect(controller.activeSessionId()).not.toBe(first);
    expect(world.createSession).toHaveBeenLastCalledWith(
      "",
      "developer",
      false,
    );
    controller.dispose();
  });

  it("regenerates by prompting the hidden marker instruction", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const face = world.faces.get("created-1");
    expect(await controller.regenerate()).toBe(true);
    expect(face?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: QA_REGENERATE_MARKER }],
      "queue",
    );
    controller.dispose();
  });
});
