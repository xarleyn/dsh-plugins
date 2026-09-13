// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import type { QaAttachmentDraft, QaSource } from "../src/types.js";
import { QaMessage } from "../src/client/components/QaMessage.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./helpers/attachments.js";

const LIMITS = DEFAULT_ATTACHMENT_LIMITS;

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

  it("attaches images from files and removes them before send", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    const onAttachmentsChange = vi.fn();
    const view = render(
      <QaComposer
        placeholder="Ask"
        attachments={[]}
        limits={LIMITS}
        onAttachmentsChange={onAttachmentsChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={vi.fn(async () => true)}
        onStop={vi.fn()}
      />,
    );
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [png], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(onAttachmentsChange).toHaveBeenCalled());
    const firstCall = onAttachmentsChange.mock.calls[0] as unknown as [
      readonly QaAttachmentDraft[],
    ];
    const drafts = firstCall[0];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "image", mediaType: "image/png" });

    // With a draft attached, sending clears both text and attachments.
    const onSend = vi.fn(async () => true);
    view.rerender(
      <QaComposer
        placeholder="Ask"
        attachments={drafts}
        limits={LIMITS}
        onAttachmentsChange={onAttachmentsChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    const input2 = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input2, { target: { value: "Смотри" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Смотри", drafts));
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it("accepts a text file and rejects an unreadable one", async () => {
    const onAttachmentsChange = vi.fn();
    render(
      <QaComposer
        placeholder="Ask"
        attachments={[]}
        limits={LIMITS}
        onAttachmentsChange={onAttachmentsChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={vi.fn(async () => true)}
        onStop={vi.fn()}
      />,
    );
    const note = new File(["hello"], "note.txt", { type: "text/plain" });
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [note],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(onAttachmentsChange).toHaveBeenCalled());
    const firstCall = onAttachmentsChange.mock.calls[0] as unknown as [
      readonly QaAttachmentDraft[],
    ];
    expect(firstCall[0][0]).toMatchObject({
      kind: "file",
      name: "note.txt",
      bytes: 5,
    });

    const binary = new File([new Uint8Array([1, 2, 3])], "setup.exe", {
      type: "application/octet-stream",
    });
    Object.defineProperty(input, "files", {
      value: [binary],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("текстовые"),
    );
  });

  it("exposes the regenerate action on demand", () => {
    const onRegenerate = vi.fn();
    const view = render(
      <QaMessage
        message={{
          id: "assistant:2",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Перегенерировать" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
    view.rerender(
      <QaMessage
        message={{
          id: "assistant:2",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Перегенерировать" }),
    ).toBeNull();
  });

  it("rates answers with mutually exclusive, persisted like and dislike", () => {
    window.localStorage.clear();
    // The surface scopes the ratings prefix to the chat: message ids repeat
    // across chats, so the key below is what QaSurface hands to QaMessage.
    const stateKey = "dsh-qa-surface.session:v1:/qa:chat:session-a";
    const view = render(
      <QaMessage
        message={{
          id: "assistant:7",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey={stateKey}
      />,
    );
    const like = screen.getByRole("button", {
      name: "Нравится",
    }) as HTMLButtonElement;
    const dislike = screen.getByRole("button", {
      name: "Не нравится",
    }) as HTMLButtonElement;
    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(like);
    expect(like.getAttribute("aria-pressed")).toBe("true");
    expect(
      JSON.parse(window.localStorage.getItem(`${stateKey}:ratings`) ?? "{}"),
    ).toEqual({ "assistant:7": "up" });
    fireEvent.click(dislike);
    expect(dislike.getAttribute("aria-pressed")).toBe("true");
    expect(like.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(dislike);
    expect(dislike.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(`${stateKey}:ratings`)).toBe("{}");
    view.unmount();
    render(
      <QaMessage
        message={{
          id: "assistant:7",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey={stateKey}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Нравится",
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("keeps equal message ids of different chats rated independently", () => {
    window.localStorage.clear();
    const chatA = "dsh-qa-surface.session:v1:/qa:chat:session-a";
    const chatB = "dsh-qa-surface.session:v1:/qa:chat:session-b";
    const message = {
      id: "assistant:3",
      role: "assistant" as const,
      text: "Answer",
      status: "committed" as const,
    };
    const base = { message, renderMarkdown: false, showTimestamp: false };
    const first = render(<QaMessage {...base} stateKey={chatA} />);
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    first.unmount();
    const second = render(<QaMessage {...base} stateKey={chatB} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Нравится",
        }) as HTMLButtonElement
      ).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      JSON.parse(window.localStorage.getItem(`${chatA}:ratings`) ?? "{}"),
    ).toEqual({ "assistant:3": "up" });
    expect(window.localStorage.getItem(`${chatB}:ratings`)).toBeNull();
    second.unmount();
  });
});
