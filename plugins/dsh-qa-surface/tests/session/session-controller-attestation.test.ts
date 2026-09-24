import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";

describe("QA session controller", () => {
  it.each([
    "agentPresetMatches",
    "workspaceMatches",
    "modelMatches",
    "sandboxModeMatches",
    "approvalIsNever",
    "toolPolicyLoaded",
  ] as const)("fails closed when %s cannot be proven", async (field) => {
    const world = harness();
    world.secureSession.mockImplementation(
      async (token: string, sessionId: string) => ({
        ok: true as const,
        value: {
          sessionId,
          enabled: true,
          agentPresetMatches: true,
          workspaceMatches: true,
          modelMatches: true,
          sandboxModeMatches: true,
          approvalIsNever: true,
          permissionPreset: "qa-read-only",
          toolPolicyLoaded: true,
          toolAllowList: [],
          [field]: false,
        },
      }),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      canSend: false,
      error: "Настройки помощника недоступны.",
    });
    controller.dispose();
  });

  it("re-binds an idled-out session once and admits the prompt", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const opensBefore = world.open.mock.calls.length;
    // First send-time attestation hits an agent whose tool view the Host
    // dismantled; the retry after the re-bind sees a healthy catalog.
    world.secureSession.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    });
    expect(await controller.send("hello")).toBe(true);
    expect(world.open.mock.calls.length).toBe(opensBefore + 1);
    expect(world.faces.get("created-1")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    controller.dispose();
  });

  it("replaces an unattestable blank session and admits the prompt", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    // Send attestation and the re-bind attestation both hit the dismantled
    // session; the blank-session fallback mints a fresh attested one.
    const refusal = {
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    };
    world.secureSession
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal);
    expect(await controller.send("hello")).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(world.open).toHaveBeenCalledWith("created-2");
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    const replacement = world.bindings.get("created-2");
    replacement?.snapshot.set(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "user",
              seq: 1,
              time: 10,
              source: {},
              content: [{ type: "text", text: "hello" }],
            },
          ] as ConversationNode[],
        }),
      ) as ConversationSnapshot,
    );
    const chatTarget = replacement?.target.mock.results[0]?.value;
    chatTarget?.set(undefined);
    expect(controller.getSnapshot().pendingMessage).toBeNull();
    expect(
      controller
        .getSnapshot()
        .messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    controller.dispose();
  });

  it("reports the refusal when recovery keeps failing", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const refusal = {
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: unknown-tools)",
        details: {},
      },
    };
    world.secureSession
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(refusal);
    expect(await controller.send("hello")).toBe(false);
    expect(world.faces.get("created-1")?.prompt).not.toHaveBeenCalled();
    expect(world.faces.get("created-2")?.prompt).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      error: "Настройки помощника недоступны.",
    });
    controller.dispose();
  });

  it("does not draft a locked session by default", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    await controller.startDraft();
    expect(world.create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    controller.dispose();
  });
});
