// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaMessage } from "../../../src/client/components/QaMessage.js";

afterEach(cleanup);
describe("branch action under an answer", () => {
  it("forks the durable answer position once and disables itself while pending", async () => {
    let settle: () => void = () => {};
    const onFork = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <QaMessage
        message={{
          id: "assistant:12",
          role: "assistant",
          text: "Answer",
          status: "committed",
          seq: 12,
          forkable: true,
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onFork={onFork}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Продолжить в новом чате",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onFork).toHaveBeenCalledExactlyOnceWith(12);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    settle();
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    );
  });
  it.each(["streaming", "failed"] as const)(
    "does not fork a %s answer",
    (status) => {
      render(
        <QaMessage
          message={{
            id: "answer",
            role: "assistant",
            text: "Answer",
            status,
            seq: 12,
            forkable: true,
          }}
          renderMarkdown={false}
          showTimestamp={false}
          onFork={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("qa-message-fork")).toBeNull();
    },
  );
  it("hides the action without a durable position or Host capability", () => {
    const view = render(
      <QaMessage
        message={{
          id: "answer",
          role: "assistant",
          text: "Answer",
          status: "committed",
        }}
        renderMarkdown={false}
        showTimestamp={false}
        onFork={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("qa-message-fork")).toBeNull();
    view.rerender(
      <QaMessage
        message={{
          id: "answer",
          role: "assistant",
          text: "Answer",
          status: "committed",
          seq: 12,
          forkable: true,
        }}
        renderMarkdown={false}
        showTimestamp={false}
      />,
    );
    expect(screen.queryByTestId("qa-message-fork")).toBeNull();
  });
});
