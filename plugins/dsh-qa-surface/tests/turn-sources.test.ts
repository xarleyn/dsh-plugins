import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { projectSources } from "../src/client/turn-sources.js";
import { legacy, snapshot } from "./helpers/conversation-fakes.js";

describe("turn sources projection", () => {
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
