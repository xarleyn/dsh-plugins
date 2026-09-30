import { describe, expect, it, vi } from "vitest";
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
    const opensBefore = world.retain.mock.calls.length;
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
    expect(world.retain.mock.calls.length).toBe(opensBefore + 1);
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
    const chatKey = controller.getSnapshot().chatKey;
    expect(await controller.send("hello")).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(world.retain).toHaveBeenCalledWith("created-2", {
      source: "qaSurface",
    });
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    // Only a chat that never received a prompt is replaced here, so the fresh
    // id is the same chat the user was writing into and it keeps its identity:
    // a new one would remount the composer over the question this send is
    // still carrying, which is how the first message of a chat used to go.
    expect(controller.getSnapshot().chatKey).toBe(chatKey);
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

  describe("with lockdown off", () => {
    const SESSION_KEY = "dsh-qa-surface.session:v1:/qa:session";

    /** The proof a Host with nothing to pin answers with, after its account gate. */
    const admitted = async (_token: string, sessionId: string) => ({
      ok: true as const,
      value: {
        sessionId,
        enabled: false,
        agentPresetMatches: true,
        workspaceMatches: true,
        modelMatches: true,
        sandboxModeMatches: false,
        approvalIsNever: false,
        permissionPreset: "",
        toolPolicyLoaded: false,
        toolAllowList: [],
      },
    });

    const refused = async (reason: string) => ({
      ok: false as const,
      error: {
        code: "internal",
        message: `Assistant configuration is unavailable. (reason: ${reason})`,
        details: {},
      },
    });

    /** The accounts facade the controller reads identity from. */
    function facade(ownedIds: readonly string[]) {
      return {
        token: () => "t-1",
        ownedIds: () => ownedIds,
        messageAuthorOf: () => undefined,
        onSessionCreated: vi.fn(),
        onAuthRequired: vi.fn(),
      };
    }

    it("still asks the Host whose chat this is before it lets the account speak", async () => {
      const world = harness(["saved"]);
      world.stored.set(SESSION_KEY, "saved");
      world.secureSession.mockImplementation(admitted);
      const controller = new QaSessionController({
        ...world,
        config: resolveConfig({ lockdown: { enabled: false } }),
        accounts: facade(["saved"]),
      });
      await controller.ensureSession();
      expect(world.secureSession).toHaveBeenCalledWith("t-1", "saved");
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        sessionId: "saved",
        canSend: true,
      });
      expect(await controller.send("hello")).toBe(true);
      expect(world.faces.get("saved")?.prompt).toHaveBeenCalledWith(
        [{ type: "text", text: "hello" }],
        "queue",
      );
      controller.dispose();
    });

    it("gives up a restored chat the Host says belongs to another account", async () => {
      const world = harness(["saved"]);
      world.stored.set(SESSION_KEY, "saved");
      world.secureSession.mockImplementation(async (_token, sessionId) =>
        sessionId === "saved"
          ? await refused("session-owned-elsewhere")
          : await admitted(_token, sessionId),
      );
      const controller = new QaSessionController({
        ...world,
        config: resolveConfig({ lockdown: { enabled: false } }),
        // The previous account's chat is still what this browser restores.
        accounts: facade([]),
      });
      await controller.ensureSession();
      expect(world.secureSession).toHaveBeenCalledWith("t-1", "saved");
      const adopted = controller.getSnapshot().sessionId;
      expect(adopted).not.toBe("saved");
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        canSend: true,
      });
      expect(await controller.send("hello")).toBe(true);
      expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
      expect(world.faces.get(String(adopted))?.prompt).toHaveBeenCalled();
      controller.dispose();
    });
  });
});
