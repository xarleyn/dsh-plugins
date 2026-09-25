import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import type { QaFileDraft, QaImageDraft } from "../../src/types.js";
import {
  deferredUpload,
  fileDraft,
  harness,
} from "../helpers/session-fakes.js";

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

  it("drops an attachment whose upload finished after the chat was left", async () => {
    // Issue #339: staging a file is an external round-trip, and the user
    // may leave the chat while it runs. The binding is re-checked before the
    // prompt, so a draft typed into one chat cannot be sent from it after the
    // operator is looking at another — and cannot leave the new chat waiting on
    // a send that was never its own.
    const world = harness(["saved", "other"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const upload = deferredUpload();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      fileUpload: () => upload.service,
    });
    await controller.ensureSession();
    const sending = controller.send("вопрос с файлом", [fileDraft()]);
    await vi.waitFor(() =>
      expect(upload.service.upload).toHaveBeenCalledOnce(),
    );

    await controller.switchTo("other");
    upload.settle();

    expect(await sending).toBe(false);
    expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
    expect(world.faces.get("other")?.prompt).not.toHaveBeenCalled();
    // The chat the operator moved to is not left showing a turn that is not
    // its own: the abandoned send must not mark admission pending here.
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().canSend).toBe(true);
    expect(controller.getSnapshot().pendingMessage).toBeNull();
    controller.dispose();
  });

  it("drops an attachment whose upload finished after the surface closed", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const upload = deferredUpload();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig(),
      fileUpload: () => upload.service,
    });
    await controller.ensureSession();
    const sending = controller.send("вопрос с файлом", [fileDraft()]);
    await vi.waitFor(() =>
      expect(upload.service.upload).toHaveBeenCalledOnce(),
    );

    controller.dispose();
    upload.settle();

    expect(await sending).toBe(false);
    expect(world.faces.get("saved")?.prompt).not.toHaveBeenCalled();
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

  it("keeps the chat identity across the session a draft creates on first send", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;

    let releaseAttestation!: (
      value: Awaited<ReturnType<typeof world.secureSession>>,
    ) => void;
    world.secureSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAttestation = resolve;
        }),
    );
    const sending = controller.send("Первый вопрос");
    // The draft's session is already bound while its proof is pending. This is
    // the moment the surface used to hand the composer a new key, which
    // discarded a question nothing had accepted yet.
    await until(() => controller.getSnapshot().sessionId === "created-2");
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      pendingMessage: { text: "Первый вопрос" },
    });

    releaseAttestation({
      ok: true,
      value: {
        sessionId: "created-2",
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
    expect(world.faces.get("created-2")?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "Первый вопрос" }],
      "queue",
    );
    expect(controller.getSnapshot().chatKey).toBe(draftKey);
    // A real move to another chat does change the identity: that composer must
    // not carry the previous conversation's text.
    await controller.switchTo("created-1");
    expect(controller.getSnapshot().chatKey).toBe(draftKey + 1);
    controller.dispose();
  });

  it("reports a first send whose session cannot be created", async () => {
    const world = harness();
    const controller = new QaSessionController({
      ...world,
      config: resolveConfig({
        ui: { showReset: true },
        lockdown: { allowSessionReset: true },
      }),
    });
    await controller.ensureSession();
    await controller.startDraft();
    const draftKey = controller.getSnapshot().chatKey;
    world.createSession.mockImplementationOnce(async () => ({
      ok: false as const,
      error: {
        code: "qa.session_create_refused",
        message: "preset unavailable",
      },
    }));

    expect(await controller.send("Первый вопрос")).toBe(false);
    // The bootstrap already spent one creation: this is the draft's own, and it
    // brought no session back.
    expect(world.createSession).toHaveBeenCalledTimes(2);
    expect(world.faces.has("created-2")).toBe(false);
    // The refusal is said out loud, and the chat identity holds still so the
    // composer keeps the text the user can send again.
    expect(controller.getSnapshot()).toMatchObject({
      chatKey: draftKey,
      sessionId: null,
      error: expect.stringMatching(/Не удалось начать чат/u),
      pendingMessage: null,
    });
    controller.dispose();
  });
});

/** Let the controller's async chain run to its next waiting point. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!predicate()) throw new Error("the controller never reached that state");
}
