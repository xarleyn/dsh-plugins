import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/resolve-config.js";
import { QaSessionController } from "../../src/client/QaSessionController.js";
import { harness } from "../helpers/session-fakes.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";
import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { QaQuestionApi } from "../../src/client/types.js";
import type { QaPendingQuestion } from "../../src/types.js";

/**
 * The chat a pending `ask_user` question blocks (wave acceptance 2026-10-28,
 * lane L07): the turn is still running, the Host parks the composed question,
 * and the browser reloads. The restored chat must carry its transcript rows
 * and the parked question panel, because answering is only possible from the
 * reopened chat.
 */

const PARKED_QUESTION: QaPendingQuestion = {
  id: "question-1",
  sessionId: "saved",
  createdAt: 1,
  questions: [
    {
      id: "q1",
      question: "Что именно понимать под сжатием?",
      header: "Требуется ответ",
      detail: null,
      multiSelect: false,
      options: [{ label: "Механизм компакции", description: null }],
    },
  ],
};

/** The transcript the chat already committed before the reload. */
function historySnapshot(): ConversationSnapshot {
  return snapshot(
    legacy({
      nodes: [
        {
          kind: "user",
          seq: 1,
          time: 10,
          source: {},
          content: [
            {
              type: "text",
              text: "Найди в документации раздел про компакцию контекста.",
            },
          ],
        },
        {
          kind: "assistant",
          seq: 2,
          turn: 1,
          messageId: "m1",
          time: 20,
          source: {},
          blocks: [
            { kind: "text", text: "Раздел найден, уточняю параметры." },
            {
              kind: "tool-call",
              callId: "call-1",
              name: "ask_user_question",
              argsRaw: "{}",
            },
          ],
        },
      ] as ConversationNode[],
    }),
  ) as ConversationSnapshot;
}

function pendingQuestionsApi(sessionId: string): {
  pendingQuestions: QaQuestionApi["pendingQuestions"];
  answerQuestion: QaQuestionApi["answerQuestion"];
  cancelQuestion: QaQuestionApi["cancelQuestion"];
} {
  return {
    pendingQuestions: vi.fn(
      async (): Promise<{
        readonly ok: true;
        readonly value: readonly QaPendingQuestion[];
      }> => ({
        ok: true,
        value:
          sessionId === "saved"
            ? [PARKED_QUESTION]
            : ([] as QaPendingQuestion[]),
      }),
    ),
    answerQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
    cancelQuestion: vi.fn(async () => ({ ok: true as const, value: true })),
  };
}

function interactiveConfig() {
  return resolveConfig({ interaction: { questions: "interactive" } });
}

describe("restoring a chat with a pending ask_user question", () => {
  it("restores the transcript and the parked question of the persisted chat", async () => {
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const face = world.faces.get("saved");
    face?.source.set({
      ...face.source.getSnapshot(),
      blank: false,
      running: true,
    });
    world.bindings.get("saved")?.snapshot.set(historySnapshot());
    const questions = pendingQuestionsApi("saved");

    const controller = new QaSessionController({
      ...world,
      questionApi: questions,
      config: interactiveConfig(),
    });

    await controller.ensureSession();
    await vi.waitFor(() => {
      const state = controller.getSnapshot();
      expect(state.sessionId).toBe("saved");
      expect(
        state.messages.some(
          (message) =>
            message.role === "user" &&
            message.text.includes("раздел про компакцию"),
        ),
      ).toBe(true);
      expect(state.questions).toEqual([PARKED_QUESTION]);
    });
    const state = controller.getSnapshot();
    // The turn is still running and its question owns the composer: a text
    // sent beside the parked form would open a second turn.
    expect(state.phase).toBe("running");
    expect(state.canSend).toBe(false);
    expect(questions.pendingQuestions).toHaveBeenCalledWith("", "saved");
    controller.dispose();
  });

  it("restores the transcript and the parked question of a chat reopened from the sidebar", async () => {
    const world = harness(["saved"]);
    world.bindings.get("saved")?.snapshot.set(historySnapshot());
    const face = world.faces.get("saved");
    face?.source.set({
      ...face.source.getSnapshot(),
      blank: false,
      running: true,
    });
    const questions = pendingQuestionsApi("saved");

    const controller = new QaSessionController({
      ...world,
      questionApi: questions,
      config: interactiveConfig(),
    });

    // A reload whose persisted id was lost lands on a draft; the visitor
    // reopens the blocked chat from the sidebar and must reach it all the same.
    await controller.ensureSession();
    expect(controller.getSnapshot().sessionId).toBeNull();

    await controller.switchTo("saved");
    await vi.waitFor(() => {
      const state = controller.getSnapshot();
      expect(state.sessionId).toBe("saved");
      expect(state.messages.length).toBeGreaterThan(0);
      expect(state.questions).toEqual([PARKED_QUESTION]);
    });
    expect(world.stored.get("dsh-qa-surface.session:v1:/qa:session")).toBe(
      "saved",
    );
    controller.dispose();
  });

  it("restores the transcript of a chat whose question the Host already took away", async () => {
    // The parked request is server-side, in-memory state: when the asking
    // agent died while the page was away, the Host has nothing parked any
    // more. The transcript still restores, and the composer unlocks with the
    // running bit gone — the chat stays answerable.
    const world = harness(["saved"]);
    world.stored.set("dsh-qa-surface.session:v1:/qa:session", "saved");
    const face = world.faces.get("saved");
    face?.source.set({ ...face.source.getSnapshot(), blank: false });
    world.bindings.get("saved")?.snapshot.set(historySnapshot());
    const questions = pendingQuestionsApi("none");

    const controller = new QaSessionController({
      ...world,
      questionApi: questions,
      config: interactiveConfig(),
    });

    await controller.ensureSession();
    await vi.waitFor(() => {
      const state = controller.getSnapshot();
      expect(state.sessionId).toBe("saved");
      expect(state.messages.length).toBeGreaterThan(0);
      expect(state.questions).toEqual([]);
    });
    expect(controller.getSnapshot().canSend).toBe(true);
    controller.dispose();
  });
});
