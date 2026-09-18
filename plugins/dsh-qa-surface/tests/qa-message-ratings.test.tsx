// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaMessage } from "../src/client/components/QaMessage.js";

describe("QA message", () => {
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

  it("sends a rating under the durable log position of the answer", () => {
    window.localStorage.clear();
    const onRateFeedback = vi.fn();
    render(
      <QaMessage
        message={{
          id: "assistant:df34a6e6",
          role: "assistant",
          text: "Answer",
          status: "committed",
          seq: 21,
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey="dsh-qa-surface.session:v1:/qa:chat:session-a"
        onRateFeedback={onRateFeedback}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    expect(onRateFeedback).toHaveBeenCalledWith({
      messageId: 21,
      rating: "positive",
    });
  });

  it("reports a rating it cannot file instead of dropping it quietly", () => {
    window.localStorage.clear();
    const onRateFeedback = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <QaMessage
        message={{
          id: "assistant:no-position",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        stateKey="dsh-qa-surface.session:v1:/qa:chat:session-a"
        onRateFeedback={onRateFeedback}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    expect(onRateFeedback).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no durable log position"),
    );
    expect(
      screen
        .getByRole("button", { name: "Нравится" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    warn.mockRestore();
  });
});
