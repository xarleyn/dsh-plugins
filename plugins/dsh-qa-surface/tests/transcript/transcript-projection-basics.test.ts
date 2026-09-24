import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { projectTranscript } from "../../src/client/QaTranscriptAdapter.js";
import { legacy, snapshot } from "../helpers/conversation-fakes.js";

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

  it("renders failed and interrupted tool results instead of dropping them", () => {
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
                  callId: "call-err",
                  name: "read",
                  argsRaw: '{"path":"D:/secret"}',
                },
                {
                  kind: "tool-call",
                  callId: "call-stop",
                  name: "web_fetch",
                  argsRaw: '{"url":"https://example.com"}',
                },
              ],
            },
            {
              kind: "tool-result",
              seq: 2,
              time: 2_000,
              callId: "call-err",
              call: { name: "read", argsRaw: '{"path":"D:/secret"}' },
              callTime: 1_100,
              content: [],
              isError: true,
              error: { name: "ToolError", code: "denied" },
              subCalls: [],
            },
            {
              kind: "tool-result",
              seq: 3,
              time: 3_000,
              callId: "call-stop",
              call: {
                name: "web_fetch",
                argsRaw: '{"url":"https://example.com"}',
              },
              callTime: 1_200,
              content: [],
              isError: false,
              error: { name: "AbortError", code: "interrupted" },
              subCalls: [],
            },
          ] as ConversationNode[],
          turnEnds: new Map([[1, 4]]),
        }),
      ),
      { showToolActivity: true },
    );

    const work = messages[0];
    if (work?.role !== "work") throw new Error("missing work projection");
    const tools = work.items.filter((item) => item.kind === "tool");
    expect(tools).toMatchObject([
      { name: "read", status: "error" },
      { name: "web_fetch", status: "stopped" },
    ]);
    expect(tools[0]).toMatchObject({ output: "ToolError: denied" });
  });
});
