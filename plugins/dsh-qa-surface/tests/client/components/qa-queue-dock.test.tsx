// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  QaQueueDock,
  type QaQueueDockProps,
} from "../../../src/client/components/QaQueueDock.js";
import type { QaQueueRow } from "../../../src/types.js";

function row(overrides: Partial<QaQueueRow> = {}): QaQueueRow {
  return {
    id: "item-1",
    preview: "второй вопрос",
    text: "второй вопрос",
    attachments: 0,
    sending: false,
    ...overrides,
  };
}

/** Mount the strip over a fixed queue, keeping the operation spies. */
function mount(overrides: Partial<QaQueueDockProps> = {}) {
  const onEdit = vi.fn(async () => null);
  const onSendNow = vi.fn(async () => null);
  const onRemove = vi.fn(async () => null);
  const view = render(
    <QaQueueDock
      rows={[row()]}
      running
      canEdit
      onEdit={onEdit}
      onSendNow={onSendNow}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { view, onEdit, onSendNow, onRemove };
}

/** The row list is folded away with the `hidden` attribute, not unmounted. */
function listHidden(view: ReturnType<typeof mount>["view"]): boolean {
  const list = view.container.querySelector(".dsh-qa-queue__list");
  return list !== null && list.hasAttribute("hidden");
}

describe("QA queue strip", () => {
  it("renders nothing while no message waits", () => {
    const { view } = mount({ rows: [] });
    expect(view.container.querySelector(".dsh-qa-queue")).toBeNull();
  });

  it("shows a single row directly, with no count to fold", () => {
    const { view } = mount();
    expect(screen.getByText("второй вопрос")).toBeTruthy();
    expect(screen.queryByText("1 в очереди")).toBeNull();
    expect(listHidden(view)).toBe(false);
  });

  it("folds several rows behind their count and opens them on demand", () => {
    const { view } = mount({
      rows: [
        row({ id: "item-1", preview: "первый" }),
        row({ id: "item-2", preview: "второй" }),
        row({ id: "item-3", preview: "третий" }),
      ],
    });
    expect(screen.getByText("3 в очереди")).toBeTruthy();
    expect(listHidden(view)).toBe(true);
    fireEvent.click(screen.getByLabelText("Развернуть очередь сообщений"));
    expect(listHidden(view)).toBe(false);
    expect(screen.getByText("третий")).toBeTruthy();
  });

  it("edits a waiting message and sends the new text", async () => {
    const { onEdit } = mount();
    fireEvent.click(screen.getByLabelText("Изменить сообщение в очереди"));
    const editor = screen.getByLabelText(
      "Текст сообщения в очереди",
    ) as HTMLTextAreaElement;
    expect(editor.value).toBe("второй вопрос");
    fireEvent.change(editor, { target: { value: "  исправленный вопрос  " } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith("item-1", "  исправленный вопрос  "),
    );
  });

  it("keeps Shift+Enter a newline and Escape a cancel", () => {
    const { onEdit } = mount();
    fireEvent.click(screen.getByLabelText("Изменить сообщение в очереди"));
    const editor = screen.getByLabelText("Текст сообщения в очереди");
    fireEvent.change(editor, { target: { value: "черновик" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Текст сообщения в очереди")).toBeNull();
  });

  it("refuses to save an emptied message", () => {
    const { onEdit } = mount();
    fireEvent.click(screen.getByLabelText("Изменить сообщение в очереди"));
    const editor = screen.getByLabelText("Текст сообщения в очереди");
    fireEvent.change(editor, { target: { value: "   " } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Текст сообщения в очереди")).toBeTruthy();
  });

  it("sends a row into the running turn only while a turn runs", async () => {
    const blocked = mount({ running: false });
    expect(
      (
        screen.getByLabelText(
          "Отправить сообщение из очереди сразу",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    blocked.view.unmount();

    const { onSendNow } = mount({ running: true });
    const button = screen.getByLabelText(
      "Отправить сообщение из очереди сразу",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onSendNow).toHaveBeenCalledWith("item-1"));
  });

  it("drops a row from the queue", async () => {
    const { onRemove } = mount();
    fireEvent.click(screen.getByLabelText("Убрать сообщение из очереди"));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("item-1"));
  });

  it("keeps the row and says why beside it when the Host refuses", async () => {
    const onRemove = vi.fn(
      async () =>
        "Не удалось убрать сообщение из очереди. Возможно, оно уже отправлено.",
    );
    const { view } = mount({ onRemove });
    fireEvent.click(screen.getByLabelText("Убрать сообщение из очереди"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/уже отправлено/u),
    );
    // The message stays where it is: the strip does not drop a row the server
    // still holds, and the answer does not depend on the next stream frame.
    expect(view.container.querySelectorAll(".dsh-qa-queue__row")).toHaveLength(
      1,
    );
    expect(
      (
        screen.getByLabelText(
          "Убрать сообщение из очереди",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("counts the attachments of a row it cannot retype", () => {
    mount({ rows: [row({ preview: "", text: null, attachments: 2 })] });
    expect(
      (
        screen.getByLabelText(
          "Изменить сообщение в очереди",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Сообщение без текста")).toBeTruthy();
    expect(screen.getByTitle("Вложений: 2")).toBeTruthy();
  });

  it("marks a row still crossing the transport and offers nothing on it", () => {
    mount({
      rows: [row({ id: "request-1", preview: "летит", sending: true })],
    });
    expect(screen.getByText("летит")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("отправляется…");
    expect(screen.queryByLabelText("Убрать сообщение из очереди")).toBeNull();
  });

  it("keeps nothing of a message the turn has taken", () => {
    // The strip only ever sees the queue it is handed, so this pins the frame
    // the claim produces: the row was actionable a frame ago — the server had
    // the message — and the claim leaves the strip with nothing to show. A row
    // still standing there, marked «отправляется…» and without a single button,
    // reads as a question that never left the browser, and the visitor types it
    // again. The projection is held to the same frame by
    // tests/session/session-controller-queue.test.ts.
    const { view, onEdit, onSendNow, onRemove } = mount();
    expect(screen.getByLabelText("Убрать сообщение из очереди")).toBeTruthy();
    view.rerender(
      <QaQueueDock
        rows={[]}
        running
        canEdit
        onEdit={onEdit}
        onSendNow={onSendNow}
        onRemove={onRemove}
      />,
    );
    expect(view.container.querySelector(".dsh-qa-queue")).toBeNull();
    expect(view.container.querySelectorAll(".dsh-qa-queue__row")).toHaveLength(
      0,
    );
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });

  it("leaves the rows readable while the binding may not write", () => {
    mount({ canEdit: false });
    expect(screen.getByText("второй вопрос")).toBeTruthy();
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("closes the editor once its row left the queue", () => {
    const { view, onEdit } = mount();
    fireEvent.click(screen.getByLabelText("Изменить сообщение в очереди"));
    expect(screen.getByLabelText("Текст сообщения в очереди")).toBeTruthy();
    view.rerender(
      <QaQueueDock
        rows={[]}
        running
        canEdit
        onEdit={onEdit}
        onSendNow={vi.fn(async () => null)}
        onRemove={vi.fn(async () => null)}
      />,
    );
    expect(view.container.querySelector(".dsh-qa-queue")).toBeNull();
  });
});
