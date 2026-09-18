import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import type { QaFileDraft, QaImageDraft } from "../src/types.js";
import { harness } from "./helpers/session-fakes.js";

describe("QA session controller", () => {
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
});
