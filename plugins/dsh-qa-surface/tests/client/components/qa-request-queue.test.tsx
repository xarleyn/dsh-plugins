// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaRequestQueue } from "../../../src/client/components/QaRequestQueue.js";
import type { QaQueueStatus } from "../../../src/types.js";

function mount(
  status: QaQueueStatus | null,
  onClose = vi.fn(),
): [typeof onClose, HTMLElement | null] {
  render(<QaRequestQueue status={status} onClose={onClose} />);
  return [
    onClose,
    screen.queryByRole("dialog", { name: "Подождите в очереди" }),
  ];
}

describe("QA request queue dialog", () => {
  afterEach(() => cleanup());

  it("is not rendered while the stand has room", () => {
    const [, dialog] = mount(null);
    expect(dialog).toBeNull();
  });

  it("says what is full, and where the question went", () => {
    const [, dialog] = mount({ limit: 2, active: 2, full: true });
    const text = dialog?.textContent ?? "";
    expect(text).toContain("не более чем на 2 вопроса");
    expect(text).toContain("в работе 2 запроса");
    // The count never claims somebody else stands in front: the turns in work
    // include this visitor's own, and the dialog must not invent a queue ahead
    // of a question it refused to send.
    expect(text).not.toContain("перед вами");
    // The load-bearing sentence: the question never left the browser, so the
    // visitor is not choosing between waiting and asking twice.
    expect(text).toContain("не отправлен и остался в поле ввода");
  });

  it("wears its own block rather than the message-queue one", () => {
    // `dsh-qa-queue*` belongs to the strip of messages waiting inside one chat;
    // this dialog is a different feature and must not read as its part.
    mount({ limit: 1, active: 1, full: true });
    const notices = document.querySelectorAll(".dsh-qa-request-queue__notice");
    expect(notices).toHaveLength(2);
    expect(document.querySelector(".dsh-qa-queue__notice")).toBeNull();
  });

  it("agrees with the count it names", () => {
    const forms: readonly (readonly [number, string])[] = [
      [1, "1 запрос"],
      [2, "2 запроса"],
      [5, "5 запросов"],
      [11, "11 запросов"],
      [21, "21 запрос"],
    ];
    for (const [active, expected] of forms) {
      const [, dialog] = mount({ limit: 2, active, full: true });
      expect(dialog?.textContent ?? "").toContain(expected);
      cleanup();
    }
  });

  it("closes on its own button", () => {
    const [onClose, dialog] = mount({ limit: 1, active: 1, full: true });
    expect(dialog).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Понятно" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
