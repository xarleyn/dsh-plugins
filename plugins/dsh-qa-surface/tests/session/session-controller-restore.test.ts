import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { QA_SESSION_IDLE_STATE } from "../../src/client/types.js";
import { harness } from "../helpers/session-fakes.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
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
    expect(world.retain).toHaveBeenCalledWith("saved", {
      source: "qaSurface",
    });
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
        listWorkspaceFiles: vi.fn(async () => ({
          ok: false as const,
          error: { code: "not-found" },
        })),
        readWorkspaceFile: vi.fn(async () => ({
          ok: false as const,
          error: { code: "not-found" },
        })),
        previewWorkspaceDocument: vi.fn(async () => ({
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

  it("opens the chat that replaces a refused restore as a chat of its own", async () => {
    const world = harness(["saved"]);
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.stored.set(storageKey, "saved");
    const proof = (sessionId: string) => ({
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
    });
    world.secureSession.mockImplementation(
      async (_token: string, sessionId: string) =>
        sessionId === "saved"
          ? { ok: false as const, error: { code: "policy-unavailable" } }
          : proof(sessionId),
    );
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const seen: number[] = [];
    const stop = controller.subscribe(() =>
      seen.push(controller.getSnapshot().chatKey),
    );
    await controller.ensureSession();
    stop();

    expect(controller.getSnapshot().sessionId).toBe("created-2");
    // The refused chat was on screen under one identity, and an empty chat took
    // its place with no prompt in flight: that is a move between chats, so the
    // replacement arrives under its own identity and the surface drops the
    // draft, the staged attachments and the drawers of the refused one instead
    // of handing them to a conversation nobody chose to open.
    expect(seen[0]).toBeGreaterThan(QA_SESSION_IDLE_STATE.chatKey);
    expect(controller.getSnapshot().chatKey).not.toBe(seen[0]);
    controller.dispose();
  });

  it("keeps the refused chat on screen when its replacement cannot be created", async () => {
    const world = harness(["saved"]);
    const storageKey = "dsh-qa-surface.session:v1:/qa:session";
    world.stored.set(storageKey, "saved");
    world.secureSession.mockImplementation(async () => ({
      ok: false as const,
      error: { code: "policy-unavailable" },
    }));
    world.createSession.mockImplementation(async () => ({
      ok: false as const,
      error: {
        code: "qa.session_create_refused",
        message: "preset unavailable",
      },
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    const seen: number[] = [];
    const stop = controller.subscribe(() =>
      seen.push(controller.getSnapshot().chatKey),
    );
    await controller.ensureSession();
    stop();

    // The replacement never arrived, so no chat was opened and nobody moved
    // between chats: the identity the surface started with still names what is
    // on screen, and the composer keeps the text the visitor was reading
    // instead of being rebuilt over an empty chat and an error.
    expect(controller.getSnapshot()).toMatchObject({
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
    });
    expect(new Set(seen).size).toBe(1);
    expect(controller.getSnapshot().chatKey).toBe(seen[0]);
    controller.dispose();
  });

  it("treats a chat that disappeared under the surface as another chat", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    const firstKey = controller.getSnapshot().chatKey;

    // The Host stopped listing the chat this browser had persisted, and the
    // operator pressed retry: the bootstrap lands on a session of its own, so
    // the surface is looking at another chat than the one it named.
    world.list.set({ ...world.list.getSnapshot(), ids: [], byId: {} });
    await controller.ensureSession();

    expect(controller.getSnapshot().sessionId).toBe("created-2");
    // What the vanished chat was holding — an unsent question, an attachment,
    // an open drawer — has to die with it rather than be inherited.
    expect(controller.getSnapshot().chatKey).not.toBe(firstKey);
    controller.dispose();
  });

  it.each([
    "composition-mismatch",
    "agent-unavailable",
    "adoption-refused",
    "subagent-session",
  ] as const)(
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
