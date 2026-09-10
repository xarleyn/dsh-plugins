import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-runtime/client";
import { describe, expect, it } from "vitest";
import {
  projectSources,
  projectTranscript,
  QA_REGENERATE_MARKER,
} from "../src/client/QaTranscriptAdapter.js";

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

  it("projects durable image attachments on user messages", () => {
    const messages = projectTranscript(
      snapshot({
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
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(messages[0]).toMatchObject({
      role: "user",
      text: "Что на скрине?",
      images: [{ attachmentId: "att-1", mediaType: "image/png" }],
    });
  });

  it("hides the regeneration marker and labels answers with their turn", () => {
    const messages = projectTranscript(
      snapshot({
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
        ] as ConversationSnapshot["nodes"],
      }),
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

  it("presents subagent launches with labels and the durable child id", () => {
    const messages = projectTranscript(
      snapshot({
        nodes: [
          {
            kind: "assistant",
            seq: 1,
            time: 1_000,
            turn: 1,
            step: 1,
            blocks: [
              {
                kind: "tool-call",
                callId: "sa-1",
                name: "subagent",
                argsRaw:
                  '{"description":"Print a greeting","prompt":"Hello","run_in_background":true}',
              },
            ],
          },
          {
            kind: "tool-result",
            seq: 2,
            time: 2_000,
            callId: "sa-1",
            call: {
              name: "subagent",
              argsRaw:
                '{"description":"Print a greeting","prompt":"Hello","run_in_background":true}',
            },
            callTime: 1_000,
            content: [
              {
                type: "text",
                text: "started subagent b5b84a41-5597-4ddb-8cb6-9a2fa90517ad",
              },
            ],
            isError: false,
            callView: null,
            resultView: null,
            subCalls: [],
          },
        ] as ConversationSnapshot["nodes"],
      }),
      { showToolActivity: true },
    );
    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    expect(work.items[0]).toMatchObject({
      kind: "tool",
      name: "subagent",
      label: "Субагент",
      summary: "Print a greeting",
      subagentId: "b5b84a41-5597-4ddb-8cb6-9a2fa90517ad",
      status: "ok",
    });
  });

  it("projects subagent settlement notices and hides other context rows", () => {
    const contextNode = (seq: number, label: string, text: string) => ({
      kind: "context" as const,
      seq,
      time: seq * 10,
      content: [{ type: "text" as const, text }],
      source: {},
      provenance: { role: "context", label },
      form: null,
    });
    const messages = projectTranscript(
      snapshot({
        nodes: [
          contextNode(
            1,
            "subagent-settled",
            "Background subagent b5b84a41 finished a run. Its closing message: Hello from subagent",
          ),
          contextNode(2, "skill-catalog", "operator skill list"),
        ] as ConversationSnapshot["nodes"],
      }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "system",
      status: "info",
    });
    const notice = messages[0];
    expect(
      notice !== undefined && notice.role !== "work" ? notice.text : "",
    ).toContain("Hello from subagent");
    expect(JSON.stringify(messages)).not.toContain("skill list");
  });

  it("projects fetched pages, searches and files as deduplicated sources", () => {
    const toolResult = (
      seq: number,
      callId: string,
      call: { name: string; argsRaw: string } | null,
      text: string,
      isError = false,
    ) => ({
      kind: "tool-result" as const,
      seq,
      time: seq * 10,
      callId,
      call,
      callTime: null,
      content: [{ type: "text" as const, text }],
      isError,
      callView: null,
      resultView: null,
      subCalls: [],
    });
    const sources = projectSources(
      snapshot({
        nodes: [
          toolResult(
            1,
            "c1",
            {
              name: "web_fetch",
              argsRaw: '{"url":"https://github.com/x/y"}',
            },
            "Первые строки страницы\nвторая строка",
          ),
          toolResult(
            2,
            "c2",
            {
              name: "web_search",
              argsRaw: '{"query":"dsh plugin api"}',
            },
            'Результаты поиска "dsh plugin api"',
          ),
          toolResult(
            3,
            "c1",
            {
              name: "web_fetch",
              argsRaw: '{"url":"https://github.com/x/y"}',
            },
            "дубль",
          ),
          toolResult(
            4,
            "c3",
            {
              name: "read",
              argsRaw: '{"file_path":"D:/repo/src/a.ts"}',
            },
            "export const a = 1",
          ),
          toolResult(
            5,
            "c4",
            {
              name: "bash",
              argsRaw: '{"command":"ls"}',
            },
            "не источник",
          ),
          // Failed calls and unresolvable targets are noise, not sources.
          toolResult(
            6,
            "c6",
            {
              name: "web_search",
              argsRaw: "{}",
            },
            "Error: DeepSeek search has no API key",
            true,
          ),
          toolResult(
            7,
            "c7",
            {
              name: "read",
              argsRaw: '{"file_path":"<path>D:/repo/AGENTS.md</path>"}',
            },
            "# AGENTS",
          ),
        ] as ConversationSnapshot["nodes"],
        runningCalls: [
          {
            callId: "c5",
            name: "web_fetch",
            argsRaw: '{"url":"https://example.com"}',
            turn: 1,
            step: 1,
            time: 60,
            callView: null,
            subCalls: [],
          },
        ],
      }),
    );
    expect(sources).toEqual([
      {
        id: "source:c1",
        kind: "web",
        target: "https://github.com/x/y",
        title: "github.com",
        snippet: "Первые строки страницы",
        output: "Первые строки страницы\nвторая строка",
      },
      {
        id: "source:c2",
        kind: "search",
        target: "dsh plugin api",
        title: "dsh plugin api",
        snippet: 'Результаты поиска "dsh plugin api"',
        output: 'Результаты поиска "dsh plugin api"',
      },
      {
        id: "source:c3",
        kind: "file",
        target: "D:/repo/src/a.ts",
        title: "a.ts",
        snippet: "export const a = 1",
        output: "export const a = 1",
      },
      {
        id: "source:c7",
        kind: "file",
        target: "D:/repo/AGENTS.md",
        title: "AGENTS.md",
        snippet: "# AGENTS",
        output: "# AGENTS",
      },
      {
        id: "source:c5",
        kind: "web",
        target: "https://example.com",
        title: "example.com",
        snippet: "",
        output: "",
      },
    ]);
  });
});
