import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import { QA_REGENERATE_MARKER } from "../src/client/QaTranscriptAdapter.js";
import type { QaFileDraft, QaImageDraft } from "../src/types.js";
import {
  harness,
  sessionFace,
  conversationBinding,
} from "./helpers/session-fakes.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";

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

  it("sends plain text, rejects slash commands, and stops generation", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    expect(await controller.send(" hello ")).toBe(true);
    expect(world.faces.get("saved")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello" }],
      "queue",
    );
    const saved = world.faces.get("saved");
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    saved?.source.set({ ...saved.source.getSnapshot(), running: false });
    expect(await controller.send("/settings")).toBe(false);
    expect(controller.getSnapshot().error).toMatch(/Команды со слешем/u);

    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    await controller.stop();
    expect(saved?.cancel).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("shows an optimistic user message while send admission is pending", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();

    let releaseAttestation!: (
      value: Awaited<ReturnType<typeof world.secureSession>>,
    ) => void;
    world.secureSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAttestation = resolve;
        }),
    );

    const pendingImage: QaImageDraft = {
      kind: "image",
      id: "draft-image",
      mediaType: "image/png",
      name: "shot.png",
      data: "AAAA",
      previewUrl: "blob:composer-preview",
    };
    const sending = controller.send(" Долгий вопрос ", [pendingImage]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "running",
      canSend: false,
      pendingMessage: {
        role: "user",
        text: "Долгий вопрос",
        status: "pending",
        images: [
          {
            attachmentId: "draft-image",
            previewUrl: "data:image/png;base64,AAAA",
          },
        ],
      },
    });

    releaseAttestation({
      ok: true,
      value: {
        sessionId: "saved",
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
    expect(await sending).toBe(true);

    const saved = world.faces.get("saved");
    saved?.source.set({ ...saved.source.getSnapshot(), running: true });
    expect(controller.getSnapshot().pendingMessage).not.toBeNull();
    saved?.source.set({ ...saved.source.getSnapshot(), running: false });
    expect(controller.getSnapshot().pendingMessage).toBeNull();
    controller.dispose();
  });

  it("stages attached files and cites their receipts in the prompt", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const fileUpload = {
      upload: vi.fn(async (_sessionId: string, _data: Blob, name?: string) => ({
        ok: true as const,
        value: {
          receiptId: `receipt-${name ?? "file"}`,
          file: {
            attachmentId: `sha256:${name ?? "file"}`,
            name: name ?? "file",
            bytes: 5,
          },
        },
      })),
    };
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      fileUpload: () => fileUpload,
    });
    await controller.ensureSession();
    const note: QaFileDraft = {
      kind: "file",
      id: "file-1",
      name: "note.txt",
      bytes: 5,
      blob: new Blob(["hello"]),
    };
    const image: QaImageDraft = {
      kind: "image",
      id: "image-1",
      mediaType: "image/png",
      name: "shot.png",
      data: "AAAA",
      previewUrl: "blob:preview",
    };
    expect(await controller.send("See attachments", [note, image])).toBe(true);
    expect(fileUpload.upload).toHaveBeenCalledWith(
      "saved",
      note.blob,
      "note.txt",
    );
    // The visitor's own order decides the prompt order, not the kind.
    expect(world.faces.get("saved")?.prompt).toHaveBeenCalledWith(
      [
        { type: "text", text: "See attachments" },
        { type: "file", receiptId: "receipt-note.txt" },
        {
          type: "image",
          mediaType: "image/png",
          data: "AAAA",
          name: "shot.png",
        },
      ],
      "queue",
    );
    controller.dispose();
  });

  it("keeps the draft when a file cannot be staged", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      fileUpload: () => ({
        upload: vi.fn(async () => ({ ok: false as const, error: "refused" })),
      }),
    });
    await controller.ensureSession();
    const note: QaFileDraft = {
      kind: "file",
      id: "file-1",
      name: "note.txt",
      bytes: 5,
      blob: new Blob(["hello"]),
    };
    expect(await controller.send("hello", [note])).toBe(false);
    expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatch(/Не удалось приложить/u);
    expect(controller.getSnapshot().pendingMessage).toBeNull();
    controller.dispose();
  });

  it("refuses a file when the page serves no upload service", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
    });
    await controller.ensureSession();
    const note: QaFileDraft = {
      kind: "file",
      id: "file-1",
      name: "note.txt",
      bytes: 5,
      blob: new Blob(["hello"]),
    };
    expect(await controller.send("hello", [note])).toBe(false);
    expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatch(/недоступны/u);
    controller.dispose();
  });

  it("starts a draft on reset and materializes the session on first send", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBe("created-1");
    await controller.startDraft();
    expect(world.create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "idle",
      sessionId: null,
      messages: [],
      canSend: true,
      canStop: false,
    });
    expect(await controller.send("hello draft")).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().sessionId).toBe("created-2");
    expect(world.faces.has("created-1")).toBe(true);
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "hello draft" }],
      "queue",
    );
    controller.dispose();
  });

  it("does not let a second send during draft materialization double-create", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ lockdown: { allowSessionReset: true } }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const first = controller.send("one");
    const second = controller.send("two");
    expect(await second).toBe(false);
    expect(await first).toBe(true);
    expect(world.create).toHaveBeenCalledTimes(2);
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "one" }],
      "queue",
    );
    controller.dispose();
  });

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

  it("surfaces a parked approval of a running chat and answers it", async () => {
    const world = harness();
    const request = {
      id: "request-1",
      sessionId: "created-1",
      toolName: "glob",
      reason: "Safety gate requests approval",
      createdAt: 1,
      delegated: false,
    };
    const pendingApprovals = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [request] })
      .mockResolvedValue({ ok: true as const, value: [] });
    const answerApproval = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { approvals: "interactive" } }),
      approvalApi: { pendingApprovals, answerApproval },
    });
    await controller.ensureSession();
    // Nothing is parked until a turn runs, so the poll follows the turn.
    expect(pendingApprovals).not.toHaveBeenCalled();
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().approvals).toEqual([request]);
    });
    expect(pendingApprovals).toHaveBeenCalledWith("", "created-1");

    await controller.answerApproval("request-1", "allowed-once");
    expect(answerApproval).toHaveBeenCalledWith(
      "",
      "created-1",
      "request-1",
      "allowed-once",
    );
    expect(controller.getSnapshot().approvals).toEqual([]);
    controller.dispose();
  });

  it("surfaces a parked question of a running chat and answers it", async () => {
    const world = harness();
    const request = {
      id: "question-1",
      sessionId: "created-1",
      createdAt: 1,
      questions: [
        {
          id: "target",
          question: "Куда писать отчёт?",
          header: null,
          detail: null,
          multiSelect: false,
          options: [{ label: "В чат", description: null }],
        },
      ],
    };
    const pendingQuestions = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [request] })
      .mockResolvedValue({ ok: true as const, value: [] });
    const answerQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const cancelQuestion = vi.fn(async () => ({
      ok: true as const,
      value: true,
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({ interaction: { questions: "interactive" } }),
      questionApi: { pendingQuestions, answerQuestion, cancelQuestion },
    });
    await controller.ensureSession();
    expect(pendingQuestions).not.toHaveBeenCalled();
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().questions).toEqual([request]);
    });
    expect(pendingQuestions).toHaveBeenCalledWith("", "created-1");

    await controller.answerQuestion("question-1", [
      { id: "target", selected: ["В чат"] },
    ]);
    expect(answerQuestion).toHaveBeenCalledWith("", "created-1", "question-1", [
      { id: "target", selected: ["В чат"] },
    ]);
    expect(controller.getSnapshot().questions).toEqual([]);

    await controller.cancelQuestion("question-1");
    expect(cancelQuestion).toHaveBeenCalledWith("", "created-1", "question-1");
    controller.dispose();
  });

  it("never polls approvals while the deployment blocks them", async () => {
    const world = harness();
    const pendingApprovals = vi.fn(async () => ({
      ok: true as const,
      value: [],
    }));
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      approvalApi: {
        pendingApprovals,
        answerApproval: vi.fn(async () => ({ ok: true as const, value: true })),
      },
    });
    await controller.ensureSession();
    const face = world.faces.get("created-1");
    face?.source.set({ ...face.source.getSnapshot(), running: true });
    await Promise.resolve();
    expect(pendingApprovals).not.toHaveBeenCalled();
    expect(controller.getSnapshot().approvals).toEqual([]);
    controller.dispose();
  });
});
