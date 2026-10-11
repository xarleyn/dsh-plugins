import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import type { QaMessage } from "../../src/types.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

const STOPPED_NOTICE =
  "Ход остановлен: ответ неполный. Отправь запрос ещё раз, чтобы получить ответ целиком.";

/** The rows a stopped turn must not be confused with, whatever it renders as. */
function roles(messages: readonly QaMessage[]): readonly string[] {
  return messages.map((message) => message.role);
}

/** The sentence one row prints; a work group prints none of its own. */
function textOf(message: QaMessage): string {
  return message.role === "work" ? "" : message.text;
}

describe("transcript projection of a stopped turn", () => {
  it("ends the turn as stopped and keeps the frozen prefix as a copyable answer", () => {
    const nodes = [
      {
        kind: "assistant",
        seq: 2,
        time: 3_000,
        turn: 1,
        step: 1,
        blocks: [
          { kind: "reasoning", text: "Reading the question." },
          { kind: "text", text: "Начало ответа, которое" },
        ],
        timing: {
          stepStartTime: 1_000,
          firstTokenTime: 1_400,
          completedTime: 3_000,
        },
        interrupted: true,
      },
    ] as ConversationNode[];
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes,
          turnTimings: new Map([[1, { startTime: 1_000, endTime: 3_000 }]]),
          turnEnds: new Map([[1, 2]]),
        }),
      ),
      { showReasoning: true },
    );

    const work = messages.find((message) => message.role === "work");
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.status).toBe("stopped");

    const answer = messages.find((message) => message.role === "assistant");
    if (answer?.role !== "assistant") throw new Error("missing answer row");
    // Committed rather than streaming: a row that never settles keeps its
    // cursor hidden forever and offers no copy button over the text it holds.
    expect(answer).toMatchObject({
      text: "Начало ответа, которое",
      status: "committed",
      seq: 2,
    });

    const notice = messages.find(
      (message) => message.role === "system" && message.text === STOPPED_NOTICE,
    );
    if (notice === undefined) throw new Error("missing stopped notice");
    expect(notice.status).toBe("info");
    expect(messages.indexOf(notice)).toBeGreaterThan(messages.indexOf(answer));
  });

  it("marks the turn stopped when the prefix carried no text at all", () => {
    // The Host assembles this node from the chunks alone, so it names no
    // message id, sits on a fractional seq and carries no timing.
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 1.1,
              time: 2_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "reasoning", text: "Осталось только думать." }],
              interrupted: true,
            },
          ] as ConversationNode[],
          turnTimings: new Map([[1, { startTime: 1_000, endTime: 2_000 }]]),
          turnEnds: new Map([[1, 1]]),
        }),
      ),
      { showReasoning: true },
    );

    expect(roles(messages)).toEqual(["work", "system"]);
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.status).toBe("stopped");
    const notice = messages.find((message) => message.role === "system");
    if (notice?.role !== "system") throw new Error("missing stopped notice");
    expect(notice.text).toBe(STOPPED_NOTICE);
  });

  it("keeps a turn the Host settled reading as complete", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 2,
              time: 3_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Ответ целиком." }],
            },
          ] as ConversationNode[],
          turnTimings: new Map([[1, { startTime: 1_000, endTime: 3_000 }]]),
          turnEnds: new Map([[1, 2]]),
        }),
      ),
    );

    const work = messages.find((message) => message.role === "work");
    expect(work).toBeUndefined();
    expect(messages[0]).toMatchObject({
      role: "assistant",
      text: "Ответ целиком.",
    });
    expect(messages.some((message) => textOf(message) === STOPPED_NOTICE)).toBe(
      false,
    );
  });

  it("leaves a provider failure naming its own outcome on a stopped turn", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 2,
              time: 3_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Оборванный префикс." }],
              interrupted: true,
            },
            {
              kind: "turn-error",
              seq: 3,
              time: 3_500,
              turn: 1,
              step: 1,
              message: "aborted",
              code: "STREAM_CLOSED",
            },
          ] as ConversationNode[],
          turnTimings: new Map([[1, { startTime: 1_000, endTime: 3_500 }]]),
          turnEnds: new Map([[1, 3]]),
        }),
      ),
    );

    const banners = messages.filter((message) => message.role === "system");
    expect(banners).toHaveLength(1);
    expect(banners[0]?.status).toBe("error");
    expect(
      messages.every((message) => textOf(message) !== STOPPED_NOTICE),
    ).toBe(true);
  });
});
