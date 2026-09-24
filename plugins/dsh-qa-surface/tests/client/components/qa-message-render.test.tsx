// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaSource } from "../../../src/types.js";
import { QaMessage } from "../../../src/client/components/QaMessage.js";

describe("QA message", () => {
  it("copies visible assistant text from the icon action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Useful answer",
          status: "committed",
        }}
        renderMarkdown
        showTimestamp={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Скопировать сообщение" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Useful answer"),
    );
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
  });

  it("reveals date, duration, TTFT and token speed for assistant answers", () => {
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Answer",
          status: "committed",
          timestamp: new Date(2026, 8, 9, 15, 44).getTime(),
          stats: { durationMs: 8_000, ttftMs: 1_100, tokensPerSecond: 89 },
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    const meta = document.querySelector(".dsh-qa-message__meta");
    expect(meta?.textContent).toContain("9 сент 15:44");
    expect(meta?.textContent).toContain("8 с");
    expect(meta?.textContent).toContain("TTFT 1,1 с");
    expect(meta?.textContent).toContain("89 ток/с");
    expect(
      document.querySelector(".dsh-qa-message__actions[data-persistent]"),
    ).toBeNull();
  });

  it("opens the exact canonical source snapshot from the answer footer", () => {
    const onOpenSources = vi.fn();
    const sources: readonly QaSource[] = [
      {
        id: "web:https://example.com/docs",
        kind: "web",
        title: "Documentation",
        uri: "https://example.com/docs",
        locations: [],
        evidence: "fetched",
        origins: [{ sessionId: "s1", turn: 1, role: "parent" }],
        score: 100,
      },
    ];
    render(
      <QaMessage
        message={{
          id: "assistant:source",
          role: "assistant",
          text: "Answer with evidence",
          status: "committed",
          turn: 1,
          sources,
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onOpenSources={onOpenSources}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Источники (1)" }));
    expect(onOpenSources).toHaveBeenCalledWith(sources, true, undefined);
  });

  it("keeps the metadata row persistent when timestamps are enabled", () => {
    render(
      <QaMessage
        message={{
          id: "assistant:1",
          role: "assistant",
          text: "Answer",
          status: "committed",
          timestamp: 1_000,
          stats: { durationMs: 500, ttftMs: null, tokensPerSecond: null },
        }}
        renderMarkdown={false}
        showTimestamp
      />,
    );
    expect(
      document.querySelector(".dsh-qa-message__actions[data-persistent]"),
    ).not.toBeNull();
    expect(
      document.querySelector(".dsh-qa-message__meta")?.textContent,
    ).not.toContain("TTFT");
  });

  it("shows the date on the user message", () => {
    render(
      <QaMessage
        message={{
          id: "user:1",
          role: "user",
          text: "Вопрос",
          status: "committed",
          timestamp: new Date(2026, 8, 9, 15, 50).getTime(),
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(
      document.querySelector(".dsh-qa-message__meta")?.textContent,
    ).toContain("9 сент 15:50");
    expect(screen.queryByRole("button", { name: "Нравится" })).toBeNull();
  });

  it("labels a foreign chat's user messages with the chat owner", () => {
    render(
      <QaMessage
        message={{
          id: "user:1",
          role: "user",
          text: "Вопрос",
          status: "committed",
          author: "Аня",
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(document.querySelector(".dsh-qa-message__byline")?.textContent).toBe(
      "Аня",
    );
    expect(
      screen.getByRole("article", { name: "Сообщение: Аня" }),
    ).toBeTruthy();
  });

  it("keeps the owner's own messages unlabeled", () => {
    render(
      <QaMessage
        message={{
          id: "user:1",
          role: "user",
          text: "Вопрос",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(document.querySelector(".dsh-qa-message__byline")).toBeNull();
  });

  it("renders an optimistic bubble with explicit preparation feedback", () => {
    render(
      <QaMessage
        message={{
          id: "pending:1",
          role: "user",
          text: "Долгий вопрос",
          status: "pending",
          images: [
            {
              attachmentId: "draft-image",
              mediaType: "image/png",
              previewUrl: "blob:preview",
            },
          ],
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );

    expect(screen.getByText("Долгий вопрос")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Подготавливаю ответ",
    );
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "blob:preview",
    );
    expect(document.querySelector(".dsh-qa-message__actions")).toBeNull();
  });

  it("renders a sent file attachment as a badged handle", () => {
    render(
      <QaMessage
        message={{
          id: "user:1",
          role: "user",
          text: "Разбери лог",
          status: "committed",
          files: [
            { attachmentId: "sha256:abc", name: "run.log", bytes: 19_456 },
          ],
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(
      document.querySelector(".dsh-qa-message__files .dsh-qa-file__badge")
        ?.textContent,
    ).toBe("LOG");
    expect(screen.getByText("run.log")).toBeTruthy();
    expect(screen.getByText("19 КБ")).toBeTruthy();
  });
});
