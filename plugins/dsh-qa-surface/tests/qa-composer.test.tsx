// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import type { QaAttachmentDraft } from "../src/types.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./helpers/attachments.js";

/** Mount one composer over a fixed policy, returning its change spy. */
function mount(overrides: Partial<Parameters<typeof QaComposer>[0]> = {}): {
  onAttachmentsChange: ReturnType<typeof vi.fn>;
} {
  const onAttachmentsChange = vi.fn();
  render(
    <QaComposer
      placeholder="Ask"
      attachments={[]}
      limits={DEFAULT_ATTACHMENT_LIMITS}
      onAttachmentsChange={onAttachmentsChange}
      canSend
      canStop={false}
      running={false}
      showStop
      status={null}
      onSend={vi.fn(async () => true)}
      onStop={vi.fn()}
      {...overrides}
    />,
  );
  return { onAttachmentsChange };
}

/** One paste event carrying plain text, the way the browser delivers it. */
function pasteText(input: HTMLElement, text: string): void {
  fireEvent.paste(input, {
    clipboardData: {
      files: [],
      getData: () => text,
    },
  });
}

describe("QA composer", () => {
  it("sends on Enter and preserves Shift+Enter", async () => {
    const send = vi.fn(async () => true);
    mount({ onSend: send });
    const input = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledWith("hello", []);
  });

  it("shows a real Stop button during generation", () => {
    mount({ canSend: false, canStop: true, running: true, status: "Скребу…" });
    expect(
      (screen.getByRole("button", { name: "Остановить" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });

  it("renders the running status inside the composer", () => {
    mount({
      canSend: false,
      canStop: true,
      running: true,
      status: "Скребу по сусекам…",
    });
    expect(screen.getByText("Скребу по сусекам…")).toBeTruthy();
  });

  it("sends a quick question from the empty-chat shortcuts", async () => {
    const send = vi.fn(async () => true);
    mount({
      onSend: send,
      placeholder: "Спросите",
      quickQuestions: [
        { label: "Что ты умеешь?", prompt: "Что ты умеешь?" },
        { label: "С чего начать?", prompt: "С чего начать?" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Что ты умеешь?" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Что ты умеешь?", []),
    );
  });

  it("shows the label but sends the prompt of a starter", async () => {
    const send = vi.fn(async () => true);
    mount({
      onSend: send,
      quickQuestions: [
        { label: "Мои задачи", prompt: "Найди мои открытые задачи в Jira" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Мои задачи" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Найди мои открытые задачи в Jira", []),
    );
  });

  it("turns a long paste into an attachment named after its line count", () => {
    const { onAttachmentsChange } = mount();
    const input = screen.getByLabelText("Задать вопрос");
    pasteText(
      input,
      `${Array.from({ length: 260 }, (_, i) => `line ${String(i)}`).join("\n")}\n`,
    );
    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const drafts = onAttachmentsChange.mock
      .calls[0]?.[0] as QaAttachmentDraft[];
    expect(drafts).toHaveLength(1);
    const stored = drafts[0];
    expect(stored).toMatchObject({
      kind: "file",
      name: "Вставленный текст (260 строк).txt",
    });
    expect(stored?.kind === "file" ? stored.bytes : 0).toBeGreaterThan(0);
  });

  it("keeps a short paste in the field", () => {
    const { onAttachmentsChange } = mount();
    pasteText(screen.getByLabelText("Задать вопрос"), "строка\nстрока\n");
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });

  it("never converts a paste when the threshold is off", () => {
    const { onAttachmentsChange } = mount({
      limits: { ...DEFAULT_ATTACHMENT_LIMITS, pastedTextLines: 0 },
    });
    pasteText(
      screen.getByLabelText("Задать вопрос"),
      Array.from({ length: 500 }, () => "x").join("\n"),
    );
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });

  it("renders a pending file card and drops it on request", () => {
    const draft: QaAttachmentDraft = {
      kind: "file",
      id: "file-1",
      name: "spec.md",
      bytes: 19_456,
      blob: new Blob(["# spec"]),
    };
    const onAttachmentsChange = vi.fn();
    render(
      <QaComposer
        placeholder="Ask"
        attachments={[draft]}
        limits={DEFAULT_ATTACHMENT_LIMITS}
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
    expect(screen.getByText("spec.md")).toBeTruthy();
    expect(screen.getByText("19 КБ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Убрать spec.md" }));
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it("refuses attachments past the pending cap", async () => {
    const { onAttachmentsChange } = mount({
      limits: { ...DEFAULT_ATTACHMENT_LIMITS, maxPending: 1 },
      attachments: [
        {
          kind: "file",
          id: "file-1",
          name: "spec.md",
          bytes: 10,
          blob: new Blob(["x"]),
        },
      ],
    });
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["hello"], "note.txt", { type: "text/plain" })],
    });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Не больше 1 вложений",
      ),
    );
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });

  it("refuses text files once the deployment turns them off", async () => {
    const { onAttachmentsChange } = mount({
      limits: { ...DEFAULT_ATTACHMENT_LIMITS, textFiles: false },
    });
    const input = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["hello"], "note.txt", { type: "text/plain" })],
    });
    fireEvent.change(input);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("PNG"),
    );
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });
});
