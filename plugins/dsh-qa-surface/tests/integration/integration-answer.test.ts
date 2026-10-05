import { describe, expect, it } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import {
  answerAfter,
  answerForRequest,
  boundAnswer,
  lastPromptSeq,
  ownTurnStillRunning,
} from "../../src/integration/answer.js";

/**
 * Reading one turn's answer out of the durable log. What the bridge publishes
 * is the last prose the turn committed: intermediate steps carry tool calls
 * with no text, a continued chat carries earlier answers, and a turn that
 * committed nothing readable has to be distinguishable from one that answered.
 */

function event(seq: number, type: string, data: unknown): StoredSessionEvent {
  return { seq, type, data };
}

function userMessage(seq: number, text: string): StoredSessionEvent {
  return event(seq, "user/message", {
    source: { kind: "user" },
    content: [{ type: "text", text }],
  });
}

function assistantMessage(
  seq: number,
  content: readonly unknown[],
  extra: Record<string, unknown> = {},
): StoredSessionEvent {
  return event(seq, "assistant/message", {
    message: { content },
    ...extra,
  });
}

describe("integration answer projection", () => {
  it("publishes the last prose of the turn, not the last message", () => {
    const events = [
      userMessage(1, "Старый вопрос"),
      assistantMessage(2, [{ type: "text", text: "Старый ответ" }]),
      userMessage(3, "Новый вопрос"),
      // A step that only called tools commits an assistant message with no
      // text; the answer is the next one.
      assistantMessage(4, [{ type: "tool-call", name: "read" }]),
      assistantMessage(5, [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "**Ответ**" },
        { type: "image" },
      ]),
    ];
    expect(answerAfter(events, 2)).toEqual({
      answer: "**Ответ**\n[изображение]",
      interrupted: false,
      seq: 5,
    });
  });

  it("reads only events after the caller's own prompt", () => {
    const events = [
      userMessage(1, "Первый вопрос"),
      assistantMessage(2, [{ type: "text", text: "Первый ответ" }]),
    ];
    // Nothing committed after the new prompt: the previous answer must not be
    // published as this turn's.
    expect(answerAfter(events, 2).answer).toBe("");
    expect(answerAfter(events, 0).answer).toBe("Первый ответ");
  });

  it("marks the turn interrupted when the last committed message was", () => {
    const events = [
      userMessage(1, "вопрос"),
      assistantMessage(2, [{ type: "text", text: "частич" }], {
        interrupted: true,
      }),
    ];
    expect(answerAfter(events, 0)).toEqual({
      answer: "частич",
      interrupted: true,
      seq: 2,
    });
  });

  it("finds the newest human prompt and skips injected context", () => {
    const events = [
      userMessage(1, "вопрос"),
      assistantMessage(2, [{ type: "text", text: "ответ" }]),
      // Injected context is recorded as a user message; it is model input, not
      // something the person typed, and it arrives *after* the answer.
      event(3, "user/message", {
        source: { kind: "plugin" },
        content: [{ type: "text", text: "note" }],
      }),
    ];
    expect(lastPromptSeq(events)).toBe(1);
    expect(lastPromptSeq([])).toBe(0);
  });

  it("tolerates unknown events and malformed payloads", () => {
    const events: StoredSessionEvent[] = [
      event(1, "something/else", { x: 1 }),
      event(2, "assistant/message", null),
      event(3, "assistant/message", { message: { content: "not an array" } }),
      userMessage(4, "вопрос"),
      assistantMessage(5, [{ type: "text", text: "ответ" }]),
    ];
    expect(answerAfter(events, 0).answer).toBe("ответ");
  });
});

describe("answering one request's own turn", () => {
  /** The durable rows the harness writes for one claimed question. */
  function turn(
    startSeq: number,
    turnNumber: number,
    requestId: string,
    answerSeq: number,
    answer: string,
  ): StoredSessionEvent[] {
    return [
      event(startSeq, "turn/start", { turn: turnNumber }),
      event(startSeq + 1, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: requestId },
        content: [{ type: "text", text: `вопрос ${requestId}` }],
      }),
      assistantMessage(answerSeq, [{ type: "text", text: answer }], {
        turn: turnNumber,
      }),
    ];
  }

  it("reads the turn its own prompt opened, not the newest one", () => {
    const events = [
      ...turn(1, 1, "req-a", 3, "Ответ A"),
      ...turn(4, 2, "req-b", 6, "Ответ B"),
    ];
    expect(answerForRequest(events, "req-a")).toEqual({
      answer: "Ответ A",
      interrupted: false,
      seq: 3,
      turn: 1,
    });
    expect(answerForRequest(events, "req-b")).toEqual({
      answer: "Ответ B",
      interrupted: false,
      seq: 6,
      turn: 2,
    });
  });

  it("shares the answer of a turn that claimed both questions", () => {
    // The loop admits whatever is queued when a turn starts, so one turn can
    // answer two questions. Each caller then reads that same prose — it is the
    // only thing their prompts produced.
    const events = [
      event(1, "turn/start", { turn: 1 }),
      event(2, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-a" },
        content: [{ type: "text", text: "первый" }],
      }),
      event(3, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-b" },
        content: [{ type: "text", text: "второй" }],
      }),
      assistantMessage(4, [{ type: "text", text: "Общий ответ" }], {
        turn: 1,
      }),
    ];
    expect(answerForRequest(events, "req-a")?.answer).toBe("Общий ответ");
    expect(answerForRequest(events, "req-b")?.answer).toBe("Общий ответ");
  });

  it("keeps injected context from ending the turn", () => {
    // A note injected after the prompt is model input, not a competing
    // question, and the answer that follows it still belongs to this turn.
    const events = [
      event(1, "turn/start", { turn: 1 }),
      event(2, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-a" },
        content: [{ type: "text", text: "вопрос" }],
      }),
      event(3, "user/message", {
        role: "user",
        source: { kind: "plugin", plugin: "dsh-notes" },
        content: [{ type: "text", text: "заметка" }],
      }),
      assistantMessage(4, [{ type: "text", text: "ответ" }], { turn: 1 }),
    ];
    expect(answerForRequest(events, "req-a")).toEqual({
      answer: "ответ",
      interrupted: false,
      seq: 4,
      turn: 1,
    });
  });

  it("reports an empty answer for a turn that committed no prose", () => {
    const events = [
      event(1, "turn/start", { turn: 1 }),
      event(2, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-a" },
        content: [{ type: "text", text: "вопрос" }],
      }),
      assistantMessage(3, [], { turn: 1, interrupted: true }),
      ...turn(4, 2, "req-b", 6, "Ответ B"),
    ];
    expect(answerForRequest(events, "req-a")).toEqual({
      answer: "",
      interrupted: true,
      seq: null,
      turn: 1,
    });
  });

  it("declines to answer for a prompt the log does not carry", () => {
    // No row names this request: the caller has to choose a cursor itself, and
    // pretending another turn's prose were the answer is worse than nothing.
    const events = turn(1, 1, "req-a", 3, "Ответ A");
    expect(answerForRequest(events, "req-unknown")).toBeUndefined();
  });

  it("brackets the window by the next question when no turn opened", () => {
    // A log whose rows arrive without a `turn/start` (a truncated read, or a
    // harness that writes the prompt before opening the turn) still separates
    // the two questions by their own rows.
    const events = [
      event(1, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-a" },
        content: [{ type: "text", text: "первый" }],
      }),
      assistantMessage(2, [{ type: "text", text: "Ответ A" }]),
      event(3, "user/message", {
        role: "user",
        source: { kind: "user", rpcId: "req-b" },
        content: [{ type: "text", text: "второй" }],
      }),
      assistantMessage(4, [{ type: "text", text: "Ответ B" }]),
    ];
    expect(answerForRequest(events, "req-a")).toEqual({
      answer: "Ответ A",
      interrupted: false,
      seq: 2,
      turn: null,
    });
    expect(answerForRequest(events, "req-b")?.answer).toBe("Ответ B");
  });
});

describe("bounding the published answer", () => {
  it("leaves an answer that fits exactly as it is", () => {
    expect(boundAnswer("короткий ответ", 4096)).toBe("короткий ответ");
    const exact = "x".repeat(64);
    expect(boundAnswer(exact, 64)).toBe(exact);
    // A budget of zero or less is "no budget configured", not "answer nothing".
    expect(boundAnswer(exact, 0)).toBe(exact);
  });

  it("cuts at a paragraph break and marks the cut", () => {
    const paragraphs = Array.from(
      { length: 6 },
      (_, index) => `Абзац ${String(index)}: ${"слово ".repeat(8)}`,
    );
    const answer = paragraphs.join("\n\n");
    const bounded = boundAnswer(answer, 300);
    expect(bounded.endsWith("…")).toBe(true);
    expect(bounded.length).toBeLessThanOrEqual(300);
    expect(answer.startsWith(bounded.slice(0, -1))).toBe(true);
    // What is published is a whole number of paragraphs, not a half sentence:
    // the kept text is exactly the leading paragraphs, in order.
    const kept = bounded.slice(0, -1).split("\n\n");
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(paragraphs.length);
    expect(paragraphs.slice(0, kept.length - 1)).toEqual(kept.slice(0, -1));
    // Only the last kept paragraph loses its trailing space, to the ellipsis.
    const last = paragraphs[kept.length - 1] ?? "";
    expect(kept[kept.length - 1]).toBe(last.trimEnd());
  });

  it("falls to the line before it cuts inside a line", () => {
    const answer = Array.from(
      { length: 30 },
      (_, index) => `строка ${String(index)} с текстом`,
    ).join("\n");
    const bounded = boundAnswer(answer, 200);
    expect(bounded.length).toBeLessThanOrEqual(200);
    const kept = bounded.slice(0, -1);
    expect(answer.startsWith(kept)).toBe(true);
    // The last published thing is a whole line, not half of one.
    const lastLine = kept.slice(kept.lastIndexOf("\n") + 1);
    expect(answer.split("\n")).toContain(lastLine);
    expect(lastLine).toBe("строка 9 с текстом");
  });

  it("never keeps a whole answer's head just to honour a boundary", () => {
    // One very early paragraph break must not shrink a full answer to a line.
    const answer = `Введение.\n\n${Array.from({ length: 40 }, (_, i) => `строка ${String(i)}`).join("\n")}`;
    const bounded = boundAnswer(answer, 200);
    expect(bounded.length).toBeGreaterThanOrEqual(100);
    expect(bounded.length).toBeLessThanOrEqual(200);
    expect(bounded.endsWith("…")).toBe(true);
  });

  it("keeps a long unbroken answer inside the budget", () => {
    const bounded = boundAnswer("a".repeat(1000), 100);
    expect(bounded.length).toBe(100);
    expect(bounded.endsWith("…")).toBe(true);
  });
});

/**
 * Whose turn the agent is running, which is what decides whether an abandoned
 * question may stop it. A prompt the harness has not claimed is still in the
 * inbox, and a turn that committed its closer is over even while the agent is
 * busy with the next one — in both cases the running turn belongs to somebody
 * else and stopping it would spend their question.
 */
describe("integration turn ownership", () => {
  const claimed = [
    event(1, "turn/start", { turn: 1 }),
    event(2, "user/message", {
      source: { kind: "user", rpcId: "req-1" },
      content: [{ type: "text", text: "вопрос" }],
    }),
  ];

  it("counts a turn claimed into as running while it has no closer", () => {
    expect(ownTurnStillRunning(claimed, "req-1")).toBe(true);
    // A tool step commits assistant text without ending the turn.
    expect(
      ownTurnStillRunning(
        [...claimed, event(3, "assistant/message", { turn: 1, message: {} })],
        "req-1",
      ),
    ).toBe(true);
  });

  it("refuses a prompt the harness has not written yet", () => {
    // Still queued behind another question's turn: that turn is not ours to stop.
    expect(
      ownTurnStillRunning(
        [
          event(1, "turn/start", { turn: 1 }),
          event(2, "user/message", {
            source: { kind: "user", rpcId: "req-2" },
            content: [{ type: "text", text: "чужой вопрос" }],
          }),
        ],
        "req-1",
      ),
    ).toBe(false);
    expect(ownTurnStillRunning([], "req-1")).toBe(false);
  });

  it("refuses a turn that committed its closer, though the agent went on", () => {
    expect(
      ownTurnStillRunning(
        [
          ...claimed,
          event(3, "turn/end", { turn: 1, reason: { kind: "done" } }),
        ],
        "req-1",
      ),
    ).toBe(false);
    // The same fact, told by the next turn opening instead.
    expect(
      ownTurnStillRunning(
        [...claimed, event(3, "turn/start", { turn: 2 })],
        "req-1",
      ),
    ).toBe(false);
  });

  it("reads a turn/end of another turn as no closer of ours", () => {
    // Interleaved logs: the closer of the earlier question says nothing about
    // this one, which is still the newest claimed turn.
    const events = [
      event(1, "turn/start", { turn: 1 }),
      event(2, "user/message", {
        source: { kind: "user", rpcId: "req-1" },
        content: [{ type: "text", text: "первый" }],
      }),
      event(3, "turn/end", { turn: 2, reason: { kind: "done" } }),
    ];
    expect(ownTurnStillRunning(events, "req-1")).toBe(true);
  });

  it("treats a newer turn in an unnumbered log as the end of ours", () => {
    const unnumbered = [
      event(1, "user/message", {
        source: { kind: "user", rpcId: "req-1" },
        content: [{ type: "text", text: "первый" }],
      }),
    ];
    expect(ownTurnStillRunning(unnumbered, "req-1")).toBe(true);
    expect(
      ownTurnStillRunning([...unnumbered, event(2, "turn/start", {})], "req-1"),
    ).toBe(false);
  });

  it("ignores injected context that is recorded as a user message", () => {
    // Synthetic payloads carry a user role but no rpc id of the caller.
    const events = [
      event(1, "user/message", {
        source: { kind: "system" },
        content: [{ type: "text", text: "заметка" }],
      }),
    ];
    expect(ownTurnStillRunning(events, "req-1")).toBe(false);
  });
});
