import { describe, expect, it } from "vitest";
import type { StoredSessionEvent } from "../../src/admin/conversation-log.js";
import { projectIntegrationTranscript } from "../../src/integration/transcript.js";

/**
 * The projector an external caller reads its own conversation through. What it
 * publishes is a narrow slice of the log on purpose: the caller's prompts and
 * the assistant's answers. Everything else the log holds — injected context,
 * tool traffic, reasoning — is either model input the caller never wrote or
 * plumbing whose result is already in the answer.
 */

function userMessage(
  seq: number,
  text: string,
  kind = "user",
): StoredSessionEvent {
  return {
    seq,
    time: 1_700_000_000_000 + seq * 1000,
    type: "user/message",
    data: {
      source: { kind },
      content: [{ type: "text", text }],
    },
  };
}

function assistantMessage(
  seq: number,
  text: string,
  options: { readonly time?: number } = {},
): StoredSessionEvent {
  return {
    seq,
    ...(options.time === undefined
      ? { time: 1_700_000_000_000 + seq * 1000 }
      : { time: options.time }),
    type: "assistant/message",
    data: {
      message: { content: [{ type: "text", text }] },
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    },
  };
}

/** A log with two complete turns, written the way the Host writes one. */
const LOG: StoredSessionEvent[] = [
  userMessage(1, "Что нового в версии 3.8?"),
  { seq: 2, type: "tool/call", data: { name: "search", args: "{}" } },
  { seq: 3, type: "tool/result", data: { name: "search", result: "…" } },
  assistantMessage(4, "**Ответ** по версии 3.8."),
  userMessage(5, "А вложения?"),
  assistantMessage(6, "Вложения принимаются."),
];

const PAGE = { after: 0, limit: 50 };

describe("integration transcript projection", () => {
  it("publishes the caller's prompts and the assistant's answers in order", () => {
    const read = projectIntegrationTranscript("session-1", LOG, PAGE);
    expect(read.chatId).toBe("session-1");
    expect(
      read.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "Что нового в версии 3.8?"],
      ["assistant", "**Ответ** по версии 3.8."],
      ["user", "А вложения?"],
      ["assistant", "Вложения принимаются."],
    ]);
    expect(read.lastSeq).toBe(6);
    expect(read.truncated).toBe(false);
  });

  it("carries the log's own timestamps as ISO instants", () => {
    const read = projectIntegrationTranscript("session-1", LOG, PAGE);
    expect(read.messages[0]?.at).toBe("2023-11-14T22:13:21.000Z");
    // A log that recorded no time for an event publishes no `at` at all: an
    // invented instant would be a fact the caller cannot check.
    const undated = projectIntegrationTranscript(
      "session-1",
      [assistantMessage(1, "ответ", { time: Number.NaN })],
      PAGE,
    );
    expect(undated.messages[0]).not.toHaveProperty("at");
  });

  it("never publishes injected context, tool traffic or reasoning", () => {
    const read = projectIntegrationTranscript(
      "session-1",
      [
        userMessage(1, "prompt", "plugin"),
        userMessage(2, "skill payload", "skill"),
        userMessage(3, "что там в 3.8?"),
        {
          seq: 4,
          type: "assistant/message",
          data: {
            message: {
              content: [
                { type: "reasoning", text: "подумаем" },
                { type: "tool-call", name: "search", args: "{}" },
              ],
            },
          },
        },
        assistantMessage(5, "Ответ."),
      ],
      PAGE,
    );
    expect(read.messages.map((message) => message.text)).toEqual([
      "что там в 3.8?",
      "Ответ.",
    ]);
  });

  it("flattens a message the way the answer itself does", () => {
    // The caller must not read two versions of one message: what it gets here
    // is the same flattening it would have received as an answer, attachments
    // named rather than dropped.
    const read = projectIntegrationTranscript(
      "session-1",
      [
        {
          seq: 1,
          type: "user/message",
          data: {
            source: { kind: "user" },
            content: [
              { type: "text", text: "вот скриншот" },
              { type: "image", mediaType: "image/png" },
            ],
          },
        },
      ],
      PAGE,
    );
    expect(read.messages[0]?.text).toBe("вот скриншот\n[изображение]");
  });

  it("treats `after` as an exclusive cursor", () => {
    const read = projectIntegrationTranscript("session-1", LOG, {
      after: 4,
      limit: 50,
    });
    expect(read.messages.map((message) => message.seq)).toEqual([5, 6]);
    expect(read.lastSeq).toBe(6);
  });

  it("returns the newest page and reports what it left below", () => {
    const read = projectIntegrationTranscript("session-1", LOG, {
      after: 0,
      limit: 2,
    });
    expect(read.messages.map((message) => message.seq)).toEqual([5, 6]);
    // The cursor stays at the newest message even when the window was cut: a
    // caller following the cursor forward never re-reads or skips a message.
    expect(read.lastSeq).toBe(6);
    expect(read.truncated).toBe(true);
  });

  it("keeps the cursor the caller brought when nothing new was written", () => {
    const read = projectIntegrationTranscript("session-1", LOG, {
      after: 6,
      limit: 50,
    });
    expect(read.messages).toEqual([]);
    expect(read.lastSeq).toBe(6);
    expect(read.truncated).toBe(false);
  });

  it("reads events the log returned out of order", () => {
    const read = projectIntegrationTranscript(
      "session-1",
      [LOG[3]!, LOG[0]!, LOG[4]!, LOG[1]!],
      PAGE,
    );
    expect(read.messages.map((message) => message.seq)).toEqual([1, 4, 5]);
    expect(read.lastSeq).toBe(5);
  });

  it("holds an empty chat to the same shape", () => {
    const read = projectIntegrationTranscript("session-1", [], PAGE);
    expect(read).toEqual({
      chatId: "session-1",
      messages: [],
      lastSeq: 0,
      truncated: false,
    });
  });
});
