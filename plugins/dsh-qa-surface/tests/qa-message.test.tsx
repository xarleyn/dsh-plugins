// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import type { QaImageDraft, QaSource } from "../src/types.js";
import { QaMessage } from "../src/client/components/QaMessage.js";

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
    fireEvent.click(screen.getByRole("button", { name: "Источники · 1" }));
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

  it("attaches images from files and removes them before send", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
      type: "image/png",
    });
    const onImagesChange = vi.fn();
    const view = render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={onImagesChange}
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
    Object.defineProperty(input, "files", { value: [png] });
    fireEvent.change(input);
    await waitFor(() => expect(onImagesChange).toHaveBeenCalled());
    const firstCall = onImagesChange.mock.calls[0] as unknown as [
      readonly QaImageDraft[],
    ];
    const drafts = firstCall[0];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.mediaType).toBe("image/png");

    // With a draft attached, sending clears both text and images.
    const onSend = vi.fn(async () => true);
    view.rerender(
      <QaComposer
        placeholder="Ask"
        images={drafts}
        onImagesChange={onImagesChange}
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
    expect(onImagesChange).toHaveBeenCalledWith([]);
  });

  it("rejects non-image files with a readable message", async () => {
    const onImagesChange = vi.fn();
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={onImagesChange}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={vi.fn(async () => true)}
        onStop={vi.fn()}
      />,
    );
    const txt = new File(["hello"], "note.txt", { type: "text/plain" });
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [txt] });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("PNG"),
    );
    expect(onImagesChange).not.toHaveBeenCalled();
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
