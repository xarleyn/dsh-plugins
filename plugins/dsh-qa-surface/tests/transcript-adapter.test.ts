import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import { describe, expect, it } from "vitest";
import { projectTranscript } from "../src/client/QaTranscriptAdapter.js";

function snapshot(
  overrides: Partial<ConversationSnapshot> = {},
): ConversationSnapshot {
  return {
    sessionId: "session-1",
    views: {} as ConversationSnapshot["views"],
    chat: {} as ConversationSnapshot["chat"],
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: "active",
    removed: false,
    openState: "open",
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  } as ConversationSnapshot;
}

describe("transcript projection", () => {
  it("keeps user and assistant text while removing hidden content", () => {
    const messages = projectTranscript(
      snapshot({
        nodes: [
          {
            kind: "user",
            seq: 1,
            time: 10,
            source: {},
            content: [
              { type: "text", text: "Question" },
              { type: "image", source: "secret" },
            ],
          },
          {
            kind: "assistant",
            seq: 2,
            time: 20,
            turn: 1,
            step: 1,
            blocks: [
              { kind: "reasoning", text: "hidden chain" },
              { kind: "text", text: "Visible answer" },
              {
                kind: "tool-call",
                callId: "1",
                name: "secretTool",
                argsRaw: "{}",
              },
            ],
          },
          {
            kind: "tool-result",
            seq: 3,
            time: 30,
            callId: "1",
            call: null,
            callTime: null,
            content: [{ type: "text", text: "raw tool secret" }],
            isError: false,
            callView: null,
            resultView: null,
            subCalls: [],
          },
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(messages.map((message) => message.text)).toEqual([
      "Question",
      "Visible answer",
    ]);
    expect(JSON.stringify(messages)).not.toContain("hidden chain");
    expect(JSON.stringify(messages)).not.toContain("raw tool secret");
  });

  it("coalesces visible partial blocks and emits generic tool activity", () => {
    expect(
      projectTranscript(
        snapshot({
          running: true,
          partial: {
            turn: 2,
            step: 1,
            blocks: [
              { kind: "text", text: "Hel" },
              { kind: "reasoning", text: "secret" },
              { kind: "text", text: "lo" },
            ],
          },
        }),
      )[0],
    ).toMatchObject({ text: "Hello", status: "streaming" });

    expect(
      projectTranscript(
        snapshot({
          runningCalls: [{}] as unknown as ConversationSnapshot["runningCalls"],
        }),
        { showToolActivity: true },
      )[0],
    ).toMatchObject({ text: "Working…", role: "system" });
  });

  it("maps raw turn failures to safe copy", () => {
    const messages = projectTranscript(
      snapshot({
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
    );
    expect(messages[0]?.text).toBe(
      "The assistant could not complete this response.",
    );
    expect(JSON.stringify(messages)).not.toContain("/home/secret");
  });
});
