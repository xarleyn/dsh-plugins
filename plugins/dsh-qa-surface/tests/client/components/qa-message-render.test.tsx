// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaSource } from "../../../src/types.js";
import { QaMessage } from "../../../src/client/components/QaMessage.js";

/**
 * Which copy paths the browser under test exposes. The plain-HTTP stand has no
 * `navigator.clipboard` at all, and a jsdom page has neither.
 */
function withClipboardApi(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function withCopyCommand(result: boolean): void {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => result),
  });
}

function withoutCopyPaths(): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: undefined,
  });
}

function renderAnswer(text: string) {
  return render(
    <QaMessage
      message={{
        id: "assistant:1",
        role: "assistant",
        text,
        status: "committed",
      }}
      renderMarkdown
      showTimestamp={false}
    />,
  );
}

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

  it("copies the answer through the copy command on an insecure page", async () => {
    withoutCopyPaths();
    withCopyCommand(true);
    renderAnswer("Useful answer");
    fireEvent.click(
      screen.getByRole("button", { name: "Скопировать сообщение" }),
    );
    await waitFor(() =>
      expect(document.execCommand).toHaveBeenCalledWith("copy"),
    );
    expect(screen.getByRole("button", { name: "Скопировано" })).toBeTruthy();
  });

  it("replaces the copy action with a manual hint where nothing can copy", () => {
    withoutCopyPaths();
    renderAnswer("Useful answer");
    expect(
      screen.queryByRole("button", { name: "Скопировать сообщение" }),
    ).toBeNull();
    expect(screen.getByTestId("qa-message-copy-hint").textContent).toBe(
      "Скопируйте вручную",
    );
  });

  it("keeps the action and names the dead end once the browser refused", async () => {
    withClipboardApi(async () => {
      throw new DOMException("denied");
    });
    withCopyCommand(false);
    renderAnswer("Useful answer");
    const action = screen.getByRole("button", {
      name: "Скопировать сообщение",
    });
    expect(screen.queryByTestId("qa-message-copy-hint")).toBeNull();
    fireEvent.click(action);
    await waitFor(() =>
      expect(screen.getByTestId("qa-message-copy-hint").textContent).toBe(
        "Скопируйте вручную",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Скопировать сообщение" }),
    ).toBeTruthy();
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
    const meta = screen.getByTestId("qa-message-meta");
    expect(meta.textContent).toContain("9 сент 15:44");
    expect(meta.textContent).toContain("8 с");
    expect(meta.textContent).toContain("TTFT 1,1 с");
    expect(meta.textContent).toContain("89 ток/с");
    expect(
      screen.getByTestId("qa-message-actions").getAttribute("data-persistent"),
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
      screen.getByTestId("qa-message-actions").getAttribute("data-persistent"),
    ).toBe("true");
    expect(screen.getByTestId("qa-message-meta").textContent).not.toContain(
      "TTFT",
    );
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
    expect(screen.getByTestId("qa-message-meta").textContent).toContain(
      "9 сент 15:50",
    );
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
    expect(screen.getByTestId("qa-message-author").textContent).toBe("Аня");
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
    expect(screen.queryByTestId("qa-message-author")).toBeNull();
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

    expect(screen.getByTestId("qa-message-content").textContent).toContain(
      "Долгий вопрос",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Подготавливаю ответ",
    );
    expect(screen.getByTestId("qa-message-image").getAttribute("src")).toBe(
      "blob:preview",
    );
    expect(screen.queryByTestId("qa-message-actions")).toBeNull();
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
    const file = within(screen.getByTestId("qa-message-files")).getByTestId(
      "qa-file",
    );
    expect(within(file).getByTestId("qa-file-badge").textContent).toBe("LOG");
    expect(within(file).getByTestId("qa-file-name").textContent).toBe(
      "run.log",
    );
    expect(within(file).getByTestId("qa-file-size").textContent).toBe("19 КБ");
  });

  it("hands the produced document over under the answer, not as a path", () => {
    const onArtifactOpen = vi.fn();
    const onArtifactDownload = vi.fn();
    render(
      <QaMessage
        message={{
          id: "assistant:2",
          role: "assistant",
          text: "Собрал отчёт одним файлом.",
          status: "committed",
          artifacts: [
            {
              path: ".qa/artifacts/documents/doc_1/report.docx",
              name: "report.docx",
              format: "docx",
              bytes: 12_595,
            },
          ],
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onArtifactOpen={onArtifactOpen}
        onArtifactDownload={onArtifactDownload}
      />,
    );
    const card = within(screen.getByTestId("qa-message-artifacts")).getByTestId(
      "qa-file",
    );
    expect(within(card).getByTestId("qa-file-badge").textContent).toBe("DOCX");
    expect(within(card).getByTestId("qa-file-name").textContent).toBe(
      "report.docx",
    );
    expect(within(card).getByTestId("qa-file-size").textContent).toBe("12 КБ");
    fireEvent.click(
      screen.getByRole("button", { name: "Открыть report.docx" }),
    );
    expect(onArtifactOpen).toHaveBeenCalledWith({
      path: ".qa/artifacts/documents/doc_1/report.docx",
      name: "report.docx",
      format: "docx",
      bytes: 12_595,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Скачать report.docx" }),
    );
    expect(onArtifactDownload).toHaveBeenCalledTimes(1);
  });

  it("names a produced file without promising a read it cannot perform", () => {
    render(
      <QaMessage
        message={{
          id: "assistant:3",
          role: "assistant",
          text: "Готово.",
          status: "committed",
          artifacts: [
            {
              path: ".qa/artifacts/documents/doc_1/report.pdf",
              name: "report.pdf",
              format: "pdf",
              bytes: 0,
            },
          ],
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    // A surface with no workspace reads still shows the card — the reader must
    // learn that the answer produced something — but offers no dead controls.
    expect(screen.getAllByTestId("qa-file")).toHaveLength(1);
    expect(screen.queryByTestId("qa-file-open")).toBeNull();
    expect(screen.queryByTestId("qa-file-download")).toBeNull();
  });
});
