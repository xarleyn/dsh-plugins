import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/resolve-config.js";
import { QaSessionController } from "../src/client/QaSessionController.js";
import type { QaImageDraft } from "../src/types.js";
import {
  harness,
  queuedMessage,
  type FakeSessionSnapshot,
  type QaSessionTestWorld,
} from "./helpers/session-fakes.js";

type QueueWorld = QaSessionTestWorld & { controller: QaSessionController };

/** Bind the stored chat and let its policy probe settle. */
async function ready(): Promise<QueueWorld> {
  const world = harness(["saved"]);
  world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
  const controller = new QaSessionController({
    ...world,
    config: resolveConfig(),
  });
  await controller.ensureSession();
  return { ...world, controller };
}

/** Drive the bound chat's snapshot the way a Host frame would. */
function setSnapshot(
  world: QueueWorld,
  snapshot: Partial<FakeSessionSnapshot>,
): void {
  const saved = world.faces.get("saved");
  if (saved === undefined) return;
  saved.source.set({ ...saved.source.getSnapshot(), ...snapshot });
}

/**
 * Drive the Host's Inbox projection: `next-turn` is the queue strip, and
 * `next-step` is steering input the strip must not list.
 */
function setInbox(
  world: QueueWorld,
  nextTurn: readonly Record<string, unknown>[],
  nextStep: readonly Record<string, unknown>[] = [],
): void {
  world.faces
    .get("saved")
    ?.inbox.set({ "next-turn": nextTurn, "next-step": nextStep });
}

describe("QA message queue", () => {
  it("keeps the composer open while a turn runs", async () => {
    const world = await ready();
    const { controller } = world;
    setSnapshot(world, { running: true });
    expect(controller.getSnapshot().canSend).toBe(true);
    controller.dispose();
  });

  it("queues a message on the Host echo instead of echoing it into the transcript", async () => {
    const world = await ready();
    const { controller } = world;
    setSnapshot(world, { running: true });
    expect(await controller.send(" второй вопрос ")).toBe(true);
    const saved = world.faces.get("saved");
    expect(saved?.beginSubmission).toHaveBeenCalledWith({
      mode: "queue",
      text: "второй вопрос",
      attachments: [],
    });
    expect(saved?.prompt).toHaveBeenCalledWith(
      [{ type: "text", text: "второй вопрос" }],
      "queue",
      undefined,
      "request-1",
    );
    // The transcript echo is for a send the agent takes right now; a queued
    // message belongs to the strip, and showing it in both places reads as two
    // copies of one question.
    expect(controller.getSnapshot().pendingMessage).toBeNull();
    controller.dispose();
  });

  it("carries an image into the queue echo as a data URL the composer cannot revoke", async () => {
    const world = await ready();
    const { controller } = world;
    setSnapshot(world, { running: true });
    const image: QaImageDraft = {
      kind: "image",
      id: "draft-image",
      mediaType: "image/png",
      name: "shot.png",
      data: "AAAA",
      previewUrl: "blob:composer-preview",
    };
    expect(await controller.send("смотри картинку", [image])).toBe(true);
    expect(
      world.faces.get("saved")?.beginSubmission.mock.calls[0]?.[0],
    ).toMatchObject({
      attachments: [
        {
          type: "image",
          value: { previewUrl: "data:image/png;base64,AAAA", name: "shot.png" },
        },
      ],
    });
    controller.dispose();
  });

  it("projects the Host queue rows with the echo still in flight folded in", async () => {
    const world = await ready();
    const { controller } = world;
    setInbox(
      world,
      [
        queuedMessage(
          "message-1",
          [{ type: "text", text: "первый в очереди" }],
          "request-1",
        ),
        queuedMessage("message-2", [
          { type: "text", text: "с картинкой" },
          { type: "image", attachment: { attachmentId: "a-1" } },
        ]),
      ],
      [
        queuedMessage("message-3", [
          { type: "text", text: "напоминание навыка" },
        ]),
      ],
    );
    setSnapshot(world, {
      running: true,
      pendingSubmissions: [
        // Already admitted: the queue row above carries the same identity.
        {
          requestId: "request-1",
          placement: "queued",
          time: 1,
          text: "уже принят",
          attachments: [],
        },
        {
          requestId: "request-2",
          placement: "queued",
          time: 2,
          text: "летит через транспорт",
          attachments: [],
        },
        // A transcript echo is the conversation's business, not the strip's.
        {
          requestId: "request-3",
          placement: "transcript",
          time: 3,
          text: "обычная отправка",
          attachments: [],
        },
      ],
    });
    expect(controller.getSnapshot().queue).toEqual([
      {
        id: "message-1",
        preview: "первый в очереди",
        text: "первый в очереди",
        attachments: 0,
        sending: false,
      },
      {
        id: "message-2",
        preview: "с картинкой",
        text: null,
        attachments: 1,
        sending: false,
      },
      {
        id: "request-2",
        preview: "летит через транспорт",
        text: "летит через транспорт",
        attachments: 0,
        sending: true,
      },
    ]);
    controller.dispose();
  });

  it("sends an edit, a send-now and a removal to the Host queue", async () => {
    const world = await ready();
    const { controller } = world;
    const saved = world.faces.get("saved");
    expect(
      await controller.queueAction("item-1", "edit", "исправленный текст"),
    ).toBeNull();
    expect(saved?.updateQueue).toHaveBeenCalledWith("item-1", {
      kind: "edit",
      content: [{ type: "text", text: "исправленный текст" }],
    });
    expect(await controller.queueAction("item-1", "steer")).toBeNull();
    expect(saved?.updateQueue).toHaveBeenCalledWith("item-1", {
      kind: "steer",
    });
    expect(await controller.queueAction("item-1", "remove")).toBeNull();
    expect(saved?.updateQueue).toHaveBeenCalledWith("item-1", {
      kind: "remove",
    });
    expect(controller.getSnapshot().error).toBeNull();
    controller.dispose();
  });

  it("answers a refused operation with the text the strip shows", async () => {
    const world = await ready();
    const { controller } = world;
    const saved = world.faces.get("saved");
    saved?.updateQueue.mockResolvedValueOnce({
      ok: false,
      error: { code: "session/queue-item-not-found", message: "claimed" },
    });
    expect(await controller.queueAction("item-9", "remove")).toMatch(
      /уже отправлено/u,
    );
    // The strip owns this answer: the shared error line is cleared by the very
    // next session frame, which is exactly what a refused steer produces.
    expect(controller.getSnapshot().error).toBeNull();
    controller.dispose();
  });

  it("answers a transport failure the same way, without stalling the strip", async () => {
    const world = await ready();
    const { controller } = world;
    world.faces
      .get("saved")
      ?.updateQueue.mockRejectedValueOnce(new Error("connection lost"));
    expect(await controller.queueAction("item-1", "steer")).toMatch(/сразу/u);
    controller.dispose();
  });

  it("edits and drops a waiting row after the turn has already ended", async () => {
    const world = await ready();
    const { controller } = world;
    setInbox(world, [
      queuedMessage("message-1", [{ type: "text", text: "вопрос" }]),
    ]);
    setSnapshot(world, { running: false });
    // Nothing is interrupting, so only "send now" is unavailable — and that is
    // the strip's decision, not the binding's.
    expect(controller.getSnapshot().canEditQueue).toBe(true);
    expect(await controller.queueAction("message-1", "remove")).toBeNull();
    controller.dispose();
  });
});
