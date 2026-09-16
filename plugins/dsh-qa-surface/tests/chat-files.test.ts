import { describe, expect, it } from "vitest";
import type { QaMessage } from "../src/types.js";
import {
  collectChatFiles,
  countChatAttachments,
  groupHasAttachments,
} from "../src/client/chat-files.js";

function userMessage(
  overrides: Partial<Extract<QaMessage, { role: "user" }> & { id: string }>,
): QaMessage {
  return {
    id: "user:1",
    role: "user",
    text: "Смотри сюда",
    status: "committed",
    ...overrides,
  } as QaMessage;
}

describe("collectChatFiles", () => {
  it("groups attachments by message, newest message first", () => {
    const messages: readonly QaMessage[] = [
      userMessage({
        id: "user:1",
        timestamp: 1_000,
        files: [
          { attachmentId: "f1", name: "notes.md", bytes: 120 },
          { attachmentId: "f2", name: "run.log", bytes: 4_096 },
        ],
      }),
      {
        id: "assistant:1",
        role: "assistant",
        text: "Ответ",
        status: "committed",
      },
      userMessage({
        id: "user:2",
        timestamp: 2_000,
        images: [{ attachmentId: "i1", mediaType: "image/png" }],
      }),
    ];
    const groups = collectChatFiles(messages);
    expect(groups.map((group) => group.messageId)).toEqual([
      "user:2",
      "user:1",
    ]);
    expect(groups[1]?.files).toHaveLength(2);
    expect(groups[0]?.images).toHaveLength(1);
    expect(groupHasAttachments(groups[0]!)).toBe(true);
    expect(countChatAttachments(groups)).toBe(3);
  });

  it("drops attachment-free user messages and ignores other roles", () => {
    const messages: readonly QaMessage[] = [
      userMessage({ id: "user:1" }),
      {
        id: "assistant:1",
        role: "assistant",
        text: "Ответ",
        status: "committed",
        sources: [],
      },
      userMessage({
        id: "user:2",
        files: [{ attachmentId: "f1", name: "a.txt", bytes: 3 }],
      }),
    ];
    const groups = collectChatFiles(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.messageId).toBe("user:2");
    expect(countChatAttachments(groups)).toBe(1);
  });

  it("returns nothing for an empty transcript", () => {
    expect(collectChatFiles([])).toEqual([]);
    expect(countChatAttachments(collectChatFiles([]))).toBe(0);
  });
});
