import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  projectTranscript,
  QA_REGENERATE_MARKER,
} from "../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";

describe("transcript projection", () => {
  it("maps raw turn failures to safe copy", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "turn-error",
              seq: 4,
              time: 40,
              turn: 1,
              step: 1,
              message: "stack /home/secret",
            },
          ],
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      text: "Помощнику не удалось завершить ответ.",
    });
    expect(JSON.stringify(messages)).not.toContain("/home/secret");
  });

  it("attaches host-recorded timing stats to finalized answers", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 1,
              time: 4_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "x".repeat(400) }],
              timing: {
                stepStartTime: 1_000,
                firstTokenTime: 2_000,
                completedTime: 4_000,
              },
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      role: "assistant",
      stats: { durationMs: 3_000, ttftMs: 1_000, tokensPerSecond: 50 },
    });
  });

  it("keeps the durable log position on the answer it emits", () => {
    // A rating is filed under the log position of the answer, so an answer that
    // reaches the browser without it can never be rated — and nothing
    // downstream can tell that the rating was dropped. Intermediate assistant
    // text stays inside the work group and is not rated at all.
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "user",
              seq: 1,
              time: 1_000,
              source: {},
              content: [{ type: "text", text: "Inspect it" }],
            },
            {
              kind: "assistant",
              seq: 2,
              time: 1_500,
              turn: 1,
              step: 1,
              blocks: [
                { kind: "text", text: "I'll inspect the repository." },
                {
                  kind: "tool-call",
                  callId: "call-1",
                  name: "bash",
                  argsRaw: '{"command":"rg TODO"}',
                },
              ],
            },
            {
              kind: "tool-result",
              seq: 3,
              time: 4_000,
              callId: "call-1",
              call: { name: "bash", argsRaw: '{"command":"rg TODO"}' },
              callTime: 1_700,
              content: [{ type: "text", text: "src/a.ts: TODO" }],
              isError: false,
              subCalls: [],
            },
            {
              kind: "assistant",
              seq: 4,
              time: 6_400,
              turn: 1,
              step: 2,
              blocks: [{ kind: "text", text: "Found one TODO." }],
            },
          ] as ConversationNode[],
          turnEnds: new Map([[1, 5]]),
        }),
      ),
      { showToolActivity: true },
    );

    expect(
      messages
        .filter((message) => message.role === "assistant")
        .map((message) => ({ text: message.text, seq: message.seq })),
    ).toEqual([{ text: "Found one TODO.", seq: 4 }]);
  });

  it("derives partial stats when the step start is missing and none without timing", () => {
    const [noFirstToken] = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 1,
              time: 4_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Answer" }],
              timing: {
                stepStartTime: 1_000,
                firstTokenTime: null,
                completedTime: 4_000,
              },
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(noFirstToken).toMatchObject({
      role: "assistant",
      stats: { durationMs: 3_000, ttftMs: null, tokensPerSecond: null },
    });

    const [untimed] = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "assistant",
              seq: 1,
              time: 4_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Answer" }],
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(untimed).toMatchObject({ role: "assistant" });
    expect(
      untimed?.role === "assistant" ? untimed.stats : "present",
    ).toBeUndefined();
  });

  it("projects durable image attachments on user messages", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "user",
              seq: 1,
              time: 1_000,
              source: {},
              content: [
                { type: "text", text: "Что на скрине?" },
                {
                  type: "image",
                  attachment: {
                    attachmentId: "att-1",
                    mediaType: "image/png",
                    bytes: 12,
                    width: 320,
                    height: 200,
                  },
                },
              ],
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      role: "user",
      text: "Что на скрине?",
      images: [{ attachmentId: "att-1", mediaType: "image/png" }],
    });
  });

  it("projects durable file attachments on user messages", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "user",
              seq: 1,
              time: 1_000,
              source: {},
              content: [
                { type: "text", text: "Разбери лог" },
                {
                  type: "file",
                  attachment: {
                    attachmentId: "sha256:abc",
                    name: "run.log",
                    bytes: 2_048,
                  },
                },
              ],
            },
            {
              kind: "user",
              seq: 2,
              time: 2_000,
              source: {},
              content: [
                {
                  type: "file",
                  attachment: { attachmentId: "sha256:def", bytes: 3 },
                },
              ],
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages[0]).toMatchObject({
      role: "user",
      text: "Разбери лог",
      files: [{ attachmentId: "sha256:abc", name: "run.log", bytes: 2_048 }],
    });
    // A malformed reference still projects a row: the prompt carried a file,
    // and hiding it would silently drop what the visitor attached.
    expect(messages[1]).toMatchObject({
      role: "user",
      text: "",
      files: [{ attachmentId: "sha256:def", name: "файл", bytes: 3 }],
    });
  });

  it("hides the regeneration marker and labels answers with their turn", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
          nodes: [
            {
              kind: "user",
              seq: 1,
              time: 1_000,
              source: {},
              content: [{ type: "text", text: "Вопрос" }],
            },
            {
              kind: "assistant",
              seq: 2,
              time: 2_000,
              turn: 1,
              step: 1,
              blocks: [{ kind: "text", text: "Первый вариант" }],
            },
            {
              kind: "user",
              seq: 3,
              time: 3_000,
              source: {},
              content: [{ type: "text", text: QA_REGENERATE_MARKER }],
            },
            {
              kind: "assistant",
              seq: 4,
              time: 4_000,
              turn: 2,
              step: 1,
              blocks: [{ kind: "text", text: "Второй вариант" }],
            },
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    expect(JSON.stringify(messages)).not.toContain("Перегенерируй");
    expect(
      messages.filter(
        (message) => message.role === "assistant" && message.turn === 2,
      ).length,
    ).toBe(1);
  });
});
