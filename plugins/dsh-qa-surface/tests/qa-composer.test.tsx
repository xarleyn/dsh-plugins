// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";

describe("QA composer", () => {
  it("sends on Enter and preserves Shift+Enter", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("hello", []);
  });

  it("shows a real Stop button during generation", () => {
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Остановить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("renders the running status inside the composer", () => {
    render(
      <QaComposer
        placeholder="Ask"
        images={[]}
        onImagesChange={vi.fn()}
        canSend={false}
        canStop
        running
        showStop
        status="Скребу по сусекам…"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText("Скребу по сусекам…")).toBeTruthy();
  });

  it("sends a quick question from the empty-chat shortcuts", async () => {
    const send = vi.fn(async () => true);
    render(
      <QaComposer
        placeholder="Спросите"
        images={[]}
        onImagesChange={vi.fn()}
        quickQuestions={["Что ты умеешь?", "С чего начать?"]}
        canSend
        canStop={false}
        running={false}
        showStop
        status={null}
        onSend={send}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Что ты умеешь?" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Что ты умеешь?", []),
    );
  });
});
