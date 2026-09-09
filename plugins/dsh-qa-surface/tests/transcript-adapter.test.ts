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
  it("keeps user and assistant text while removing hidden content by default", () => {
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
    expect(
      messages.flatMap((message) =>
        message.role === "work" ? [] : [message.text],
      ),
    ).toEqual(["Question", "Visible answer"]);
    expect(JSON.stringify(messages)).not.toContain("hidden chain");
    expect(JSON.stringify(messages)).not.toContain("raw tool secret");
  });

  it("coalesces visible partial blocks and projects running tools", () => {
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
          running: true,
          runningCalls: [
            {
              callId: "running-1",
              name: "bash",
              argsRaw: '{"command":"pwd"}',
              turn: 2,
              step: 1,
              time: 20,
              callView: null,
              subCalls: [],
            },
          ],
        }),
        { showToolActivity: true },
      )[0],
    ).toMatchObject({
      role: "work",
      status: "running",
      items: [{ kind: "tool", name: "bash", status: "running" }],
    });
  });

  it("groups reasoning, progress, and tools before the final answer", () => {
    const messages = projectTranscript(
      snapshot({
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
              { kind: "reasoning", text: "I should inspect the tree." },
              { kind: "text", text: "I'll inspect the repository." },
              {
                kind: "tool-call",
                callId: "call-1",
                name: "bash",
                argsRaw: '{"command":"rg TODO","description":"Find TODOs"}',
              },
            ],
          },
          {
            kind: "tool-result",
            seq: 3,
            time: 4_000,
            callId: "call-1",
            call: {
              name: "bash",
              argsRaw: '{"command":"rg TODO","description":"Find TODOs"}',
            },
            callTime: 1_700,
            content: [{ type: "text", text: "src/a.ts: TODO" }],
            isError: false,
            callView: null,
            resultView: null,
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
        ] as ConversationSnapshot["nodes"],
        turnTimings: new Map([[1, { startTime: 1_000, endTime: 6_400 }]]),
        turnEnds: new Map([[1, 5]]),
      }),
      { showReasoning: true, showToolActivity: true },
    );

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "work",
      "assistant",
    ]);
    const work = messages[1];
    expect(work?.role).toBe("work");
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work).toMatchObject({
      status: "complete",
      startedAt: 1_000,
      endedAt: 6_400,
    });
    expect(work.items.map((item) => item.kind)).toEqual([
      "reasoning",
      "progress",
      "tool",
    ]);
    expect(work.items[2]).toMatchObject({
      kind: "tool",
      label: "Bash",
      summary: "Find TODOs",
      output: "src/a.ts: TODO",
      status: "ok",
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      text: "Found one TODO.",
    });
  });

  it("keeps pre-tool assistant text inside work until the final answer exists", () => {
    const messages = projectTranscript(
      snapshot({
        running: true,
        nodes: [
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
                argsRaw: '{"command":"pwd"}',
              },
            ],
          },
        ] as ConversationSnapshot["nodes"],
        runningCalls: [
          {
            callId: "call-1",
            name: "bash",
            argsRaw: '{"command":"pwd"}',
            turn: 1,
            step: 1,
            time: 1_700,
            callView: null,
            subCalls: [],
          },
        ],
        turnTimings: new Map([[1, { startTime: 1_000 }]]),
      }),
      { showToolActivity: true },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "work",
      status: "running",
      items: [
        { kind: "progress", text: "I'll inspect the repository." },
        { kind: "tool", name: "bash", status: "running" },
      ],
    });
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
    expect(messages[0]).toMatchObject({
      text: "Помощнику не удалось завершить ответ.",
    });
    expect(JSON.stringify(messages)).not.toContain("/home/secret");
  });

  it("attaches host-recorded timing stats to finalized answers", () => {
    const messages = projectTranscript(
      snapshot({
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
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(messages[0]).toMatchObject({
      role: "assistant",
      stats: { durationMs: 3_000, ttftMs: 1_000, tokensPerSecond: 50 },
    });
  });

  it("derives partial stats when the step start is missing and none without timing", () => {
    const [noFirstToken] = projectTranscript(
      snapshot({
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
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(noFirstToken).toMatchObject({
      role: "assistant",
      stats: { durationMs: 3_000, ttftMs: null, tokensPerSecond: null },
    });

    const [untimed] = projectTranscript(
      snapshot({
        nodes: [
          {
            kind: "assistant",
            seq: 1,
            time: 4_000,
            turn: 1,
            step: 1,
            blocks: [{ kind: "text", text: "Answer" }],
          },
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(untimed).toMatchObject({ role: "assistant" });
    expect(
      untimed?.role === "assistant" ? untimed.stats : "present",
    ).toBeUndefined();
  });
});
