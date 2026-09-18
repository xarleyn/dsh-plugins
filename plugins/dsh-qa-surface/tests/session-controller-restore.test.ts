import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { harness } from "./helpers/session-fakes.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";

describe("QA session controller", () => {
  it("restores a valid persisted session without creating one", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "saved",
      canSend: true,
    });
    expect(world.create).not.toHaveBeenCalled();
    expect(world.open).toHaveBeenCalledWith("saved");
    controller.dispose();
  });

  it("uses the Host provenance snapshot as the authoritative source view", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const sources = vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          version: 1 as const,
          sessionId: "saved",
          turn: 3,
          complete: false,
          incompleteOrigins: [
            {
              subagentRunId: "opaque-run",
              provider: "remote",
              reason: "opaque",
            },
          ],
          sources: [
            {
              id: "web:https://example.com/docs",
              kind: "web" as const,
              title: "Host docs",
              uri: "https://example.com/docs",
              locations: [],
              evidence: "reported" as const,
              origins: [
                {
                  role: "subagent" as const,
                  sessionId: "saved",
                  turn: 3,
                  subagentRunId: "opaque-run",
                },
              ],
              score: 80,
            },
          ],
        },
      ],
    }));
    const controller = new QaSessionController({
      ...world,
      sourceApi: {
        sources,
        readSourceFile: vi.fn(async () => ({
          ok: false as const,
          error: { code: "not-found" },
        })),
      },
      config: resolveConfig(),
    });

    await controller.ensureSession();
    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({
        sources: [{ id: "web:https://example.com/docs" }],
        sourcesComplete: false,
        incompleteSourceOrigins: [{ subagentRunId: "opaque-run" }],
      });
    });
    expect(sources).toHaveBeenCalledWith("", "saved");
    controller.dispose();
  });

  it("replaces a stale id through Host-authoritative creation", async () => {
    const world = harness();
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "gone");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: {
          provider: "provider",
          model: "model",
          reasoningEffort: "high",
        },
      }),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "created-1",
    );
    expect(world.createSession).toHaveBeenCalledWith("", null, false);
    expect(world.api.selectModel).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("replaces a persisted session rejected by the Host policy", async () => {
    const world = harness(["saved"]);
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.stored.set(storageKey, "saved");
    world.secureSession.mockImplementation(
      async (token: string, sessionId: string) =>
        sessionId === "saved"
          ? {
              ok: false as const,
              error: { code: "policy-unavailable" },
            }
          : {
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
              },
            },
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "created-2",
      canSend: true,
      error: null,
    });
    expect(world.secureSession).toHaveBeenNthCalledWith(1, "", "saved");
    expect(world.secureSession).toHaveBeenNthCalledWith(2, "", "created-2");
    expect(world.stored.get(storageKey)).toBe("created-2");
    controller.dispose();
  });

  it.each(["composition-mismatch", "agent-unavailable", "adoption-refused"])(
    "opens a persisted %s chat as a read-only historical transcript",
    async (reason) => {
      const world = harness(["saved"]);
      const storageKey = "dsh-qa-surface.session:v1:/qa:session";
      world.stored.set(storageKey, "saved");
      const face = world.faces.get("saved");
      face?.source.set({
        ...face.source.getSnapshot(),
        blank: false,
        running: true,
      });
      const binding = world.bindings.get("saved");
      binding?.snapshot.set(
        snapshot(
          legacy({
            nodes: [
              {
                kind: "user",
                seq: 1,
                time: 10,
                source: {},
                content: [{ type: "text", text: "old question" }],
              },
            ] as ConversationNode[],
          }),
        ) as ConversationSnapshot,
      );
      world.secureSession.mockResolvedValue({
        ok: false as const,
        error: {
          code: "internal",
          message: `Assistant configuration is unavailable. (reason: ${reason})`,
          details: {},
        },
      });
      const approvalAnswer = vi.fn(async () => ({
        ok: true as const,
        value: true,
      }));
      const controller = new QaSessionController({
        ...world,
        approvalApi: {
          pendingApprovals: vi.fn(async () => ({
            ok: true as const,
            value: [],
          })),
          answerApproval: approvalAnswer,
        },
        config: resolveConfig(),
      });

      await controller.ensureSession();

      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        sessionId: "saved",
        compatibilityReadOnly: true,
        canSend: false,
        canStop: false,
        error: null,
      });
      expect(
        controller
          .getSnapshot()
          .messages.some(
            (message) =>
              message.role === "user" && message.text === "old question",
          ),
      ).toBe(true);
      expect(world.create).not.toHaveBeenCalled();
      expect(world.stored.get(storageKey)).toBe("saved");
      expect(await controller.send("must not escape read-only mode")).toBe(
        false,
      );
      await controller.stop();
      await controller.answerApproval("approval-1", "allowed-once");
      expect(face?.prompt).not.toHaveBeenCalled();
      expect(face?.cancel).not.toHaveBeenCalled();
      expect(approvalAnswer).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it("opens a historical chat from the sidebar without replacing the current chat", async () => {
    const world = harness(["historical"]);
    world.secureSession.mockImplementation(
      async (token: string, sessionId: string) =>
        sessionId === "historical"
          ? {
              ok: false as const,
              error: {
                code: "internal",
                message:
                  "Assistant configuration is unavailable. (reason: composition-mismatch)",
                details: {},
              },
            }
          : {
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
              },
            },
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const current = controller.getSnapshot().sessionId;

    await controller.switchTo("historical");

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: "historical",
      compatibilityReadOnly: true,
      canSend: false,
      error: null,
    });
    expect(world.create).toHaveBeenCalledOnce();
    expect(current).not.toBe("historical");
    controller.dispose();
  });

  it("does not persist a newly created session before policy attestation", async () => {
    const world = harness();
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.secureSession.mockResolvedValue({
      ok: false as const,
      error: { code: "policy-unavailable" },
    });
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
    expect(world.stored.has(storageKey)).toBe(false);
    controller.dispose();
  });

  it("never downgrades a newly created mismatched session to compatibility mode", async () => {
    const world = harness();
    world.secureSession.mockResolvedValue({
      ok: false as const,
      error: {
        code: "internal",
        message:
          "Assistant configuration is unavailable. (reason: composition-mismatch)",
        details: {},
      },
    });
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });

    await controller.ensureSession();

    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      compatibilityReadOnly: false,
      canSend: false,
      error: "Настройки помощника недоступны.",
    });
    controller.dispose();
  });

  it("leaves configured composition to Host creation", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        session: { agentPreset: "qa-assistant" },
      }),
    });
    await controller.ensureSession();
    expect(world.createSession).toHaveBeenCalledWith("", null, false);
    expect(world.selectAgentPreset).not.toHaveBeenCalled();
    expect(world.secureSession).toHaveBeenCalledWith("", "created-1");
    controller.dispose();
  });
});
