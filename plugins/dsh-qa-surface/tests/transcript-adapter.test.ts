import type {
  ConversationNode,
  ConversationSnapshot,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  ChatSnapshot,
  LegacyConversationSlice,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import { describe, expect, it } from "vitest";
import {
  projectSources,
  projectTranscript,
  QA_REGENERATE_MARKER,
} from "../src/client/QaTranscriptAdapter.js";

function legacy(
  overrides: Partial<LegacyConversationSlice> = {},
): LegacyConversationSlice {
  return {
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    ...overrides,
  };
}

function snapshot(
  slice: LegacyConversationSlice = legacy(),
): ConversationSnapshot {
  const chat = { legacy: slice } as unknown as ChatSnapshot;
  return {
    views: { get: (target) => (target === "chat" ? chat : undefined) },
    activeTargets: new Set(["chat"]),
  };
}

describe("transcript projection", () => {
  it("keeps user and assistant text while removing hidden content by default", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
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
              subCalls: [],
            },
          ] as ConversationNode[],
        }),
      ),
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
        snapshot(
          legacy({
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
        ),
        { running: true },
      )[0],
    ).toMatchObject({ text: "Hello", status: "streaming" });

    expect(
      projectTranscript(
        snapshot(
          legacy({
            runningCalls: [
              {
                callId: "running-1",
                name: "bash",
                argsRaw: '{"command":"pwd"}',
                turn: 2,
                step: 1,
                time: 20,
                subCalls: [],
              },
            ],
          }),
        ),
        { running: true, showToolActivity: true },
      )[0],
    ).toMatchObject({
      role: "work",
      status: "running",
      items: [{ kind: "tool", name: "bash", status: "running" }],
    });
  });

  it("groups reasoning, progress, and tools before the final answer", () => {
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
          turnTimings: new Map([[1, { startTime: 1_000, endTime: 6_400 }]]),
          turnEnds: new Map([[1, 5]]),
        }),
      ),
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
      snapshot(
        legacy({
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
          ] as ConversationNode[],
          runningCalls: [
            {
              callId: "call-1",
              name: "bash",
              argsRaw: '{"command":"pwd"}',
              turn: 1,
              step: 1,
              time: 1_700,
              subCalls: [],
            },
          ],
          turnTimings: new Map([[1, { startTime: 1_000 }]]),
        }),
      ),
      { running: true, showToolActivity: true },
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

  it("presents subagent launches with labels and the durable child id", () => {
    const messages = projectTranscript(
      snapshot(
        legacy({
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
              subCalls: [],
            },
          ] as ConversationNode[],
        }),
      ),
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

  it("folds subagent settlements into titled collapsible notices", () => {
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
      snapshot(
        legacy({
          nodes: [
            contextNode(
              1,
              "subagent-settled",
              "Background subagent b5b84a41-5597-4ddb-8cb6-9a2fa90517ad finished and will do no further work unless you send it more.Its closing message:**Found 130 TODO lines** | file | excerpt",
            ),
            contextNode(2, "skill-catalog", "operator skill list"),
          ] as ConversationNode[],
        }),
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "system",
      status: "info",
      text: "Субагент b5b84a41 завершён",
      notice: {
        title: "Субагент b5b84a41 завершён",
        body: "**Found 130 TODO lines** | file | excerpt",
      },
    });
    expect(JSON.stringify(messages)).not.toContain("skill list");
    expect(JSON.stringify(messages)).not.toContain("will do no further work");
  });

  it("projects fetched pages, searches and files as deduplicated sources", () => {
    const toolResult = (
      seq: number,
      callId: string,
      call: { name: string; argsRaw: string } | null,
      text: string,
      isError = false,
      meta?: unknown,
    ) => ({
      kind: "tool-result" as const,
      seq,
      time: seq * 10,
      callId,
      call,
      callTime: null,
      content: [{ type: "text" as const, text }],
      isError,
      ...(meta === undefined ? {} : { meta }),
      subCalls: [],
    });
    const sources = projectSources(
      snapshot(
        legacy({
          nodes: [
            toolResult(
              1,
              "c1",
              {
                name: "web_fetch",
                argsRaw: '{"url":"https://github.com/x/y"}',
              },
              "Первые строки страницы\nвторая строка",
              false,
              {
                url: "https://github.com/x/y?utm_source=search",
                statusCode: 200,
                truncated: false,
              },
            ),
            toolResult(
              2,
              "c2",
              {
                name: "web_search",
                argsRaw: '{"query":"dsh plugin api"}',
              },
              'Результаты поиска "dsh plugin api"',
              false,
              {
                sources: [
                  {
                    url: "https://github.com/x/y",
                    title: "Repository docs",
                    snippet: "same page",
                  },
                  {
                    url: "https://docs.example.com/plugin",
                    title: "Plugin API",
                    snippet: "API reference",
                  },
                ],
                truncated: false,
              },
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
              false,
              {
                path: "D:/repo/src/a.ts",
                offset: 40,
                lines: [{ number: 40, text: "export const a = 1" }],
                totalLines: 80,
                lang: "ts",
              },
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
          ] as ConversationNode[],
          runningCalls: [
            {
              callId: "c5",
              name: "web_fetch",
              argsRaw: '{"url":"https://example.com"}',
              turn: 1,
              step: 1,
              time: 60,
              subCalls: [],
            },
          ],
        }),
      ),
    );
    expect(sources).toHaveLength(4);
    expect(sources).toEqual([
      expect.objectContaining({
        id: "web:https://github.com/x/y",
        kind: "web",
        evidence: "fetched",
        score: 100,
      }),
      expect.objectContaining({
        id: "file:d:/repo/src/a.ts",
        kind: "code",
        locations: [{ path: "d:/repo/src/a.ts", lineStart: 40, lineEnd: 40 }],
        evidence: "read",
      }),
      expect.objectContaining({
        id: "file:d:/repo/AGENTS.md",
        kind: "file",
        evidence: "read",
      }),
      expect.objectContaining({
        id: "web:https://docs.example.com/plugin",
        kind: "web",
        title: "Plugin API",
        evidence: "queried",
        score: 55,
      }),
    ]);
    expect(JSON.stringify(sources)).not.toContain("dsh plugin api");
    expect(JSON.stringify(sources)).not.toContain("https://example.com");
  });
});
