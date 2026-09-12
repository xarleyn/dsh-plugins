// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { QaWorkItem } from "../src/types.js";
import { sameMessage } from "../src/client/components/QaMessage.js";
import {
  sameWorkItem,
  sameWorkItems,
} from "../src/client/components/QaWorkGroup.js";
import { sameChatRows } from "../src/client/components/QaSidebar.js";

describe("render equality helpers", () => {
  // The projection rebuilds every object per frame; the memoized render path
  // must treat a field-identical copy as equal and spot any content change.
  const userMessage = {
    id: "user:1",
    role: "user" as const,
    text: "Как сбросить кэш?",
    status: "committed" as const,
    timestamp: 90_000,
    images: [{ attachmentId: "att-1", mediaType: "image/png" as const }],
  };
  const assistantMessage = {
    id: "assistant:2",
    role: "assistant" as const,
    text: "Откройте настройки.",
    status: "committed" as const,
    timestamp: 95_000,
    turn: 1,
    stats: { durationMs: 9_000, ttftMs: 900, tokensPerSecond: 42 },
  };
  const systemMessage = {
    id: "context:3",
    role: "system" as const,
    text: "Субагент a1b2c3d4 завершён",
    status: "info" as const,
    timestamp: 97_000,
    notice: { title: "Субагент a1b2c3d4 завершён", body: "Готово." },
  };
  const reasoningItem: Extract<QaWorkItem, { kind: "reasoning" | "progress" }> =
    {
      id: "reasoning:1:0",
      kind: "reasoning",
      text: "Мысль.",
      status: "complete",
    };
  const toolItem: Extract<QaWorkItem, { kind: "tool" }> = {
    id: "tool:1:a",
    kind: "tool",
    name: "read",
    label: "Чтение",
    summary: "D:/file.ts",
    input: '{ "path": "D:/file.ts" }',
    output: "Содержимое",
    status: "ok",
    startedAt: 90_100,
    endedAt: 90_400,
  };
  const workMessage = {
    id: "work:1",
    role: "work" as const,
    turn: 1,
    status: "complete" as const,
    startedAt: 90_000,
    endedAt: 95_000,
    items: [reasoningItem, toolItem],
  };

  it("treats a fresh field-identical copy of each message variant as equal", () => {
    expect(sameMessage(userMessage, { ...userMessage })).toBe(true);
    expect(sameMessage(assistantMessage, { ...assistantMessage })).toBe(true);
    expect(sameMessage(systemMessage, { ...systemMessage })).toBe(true);
    expect(sameMessage(workMessage, { ...workMessage })).toBe(true);
  });

  it("spots content changes on each message variant", () => {
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        text: "Другой текст.",
      }),
    ).toBe(false);
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        stats: { durationMs: 9_001, ttftMs: 900, tokensPerSecond: 42 },
      }),
    ).toBe(false);
    expect(
      sameMessage(assistantMessage, {
        ...assistantMessage,
        stats: undefined,
      }),
    ).toBe(false);
    expect(
      sameMessage(userMessage, {
        ...userMessage,
        images: [{ attachmentId: "att-2", mediaType: "image/png" as const }],
      }),
    ).toBe(false);
    expect(
      sameMessage(systemMessage, {
        ...systemMessage,
        notice: { title: "Субагент a1b2c3d4 завершён", body: "Другое." },
      }),
    ).toBe(false);
    expect(
      sameMessage(workMessage, { ...workMessage, status: "running" }),
    ).toBe(false);
    expect(
      sameMessage(
        { ...assistantMessage },
        { ...userMessage, id: "assistant:2" },
      ),
    ).toBe(false);
  });

  it("compares work items by rendered content", () => {
    expect(sameWorkItem(reasoningItem, { ...reasoningItem })).toBe(true);
    expect(sameWorkItem(toolItem, { ...toolItem })).toBe(true);
    expect(
      sameWorkItem(reasoningItem, { ...reasoningItem, text: "Другая мысль." }),
    ).toBe(false);
    expect(sameWorkItem(toolItem, { ...toolItem, output: "Другое" })).toBe(
      false,
    );
    expect(sameWorkItem(toolItem, { ...toolItem, status: "error" })).toBe(
      false,
    );
    expect(sameWorkItem(reasoningItem, toolItem)).toBe(false);
    expect(sameWorkItems(workMessage.items, [...workMessage.items])).toBe(true);
    expect(sameWorkItems(workMessage.items, [reasoningItem])).toBe(false);
  });

  it("compares sidebar rows by content", () => {
    const row = {
      id: "s-1",
      title: "Chat",
      running: false,
      active: false,
      meta: "1m",
      updatedAt: 1,
    };
    expect(sameChatRows([row], [{ ...row }])).toBe(true);
    expect(sameChatRows([row], [{ ...row, meta: "2m" }])).toBe(false);
    expect(sameChatRows([row], [])).toBe(false);
  });
});
