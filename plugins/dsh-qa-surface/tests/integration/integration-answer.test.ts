import { describe, expect, it } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import {
  answerAfter,
  boundAnswer,
  lastPromptSeq,
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
