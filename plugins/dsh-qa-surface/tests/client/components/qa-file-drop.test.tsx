// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaComposer } from "../../../src/client/components/QaComposer.js";
import { QaFormItem } from "../../../src/client/components/QaFormItem.js";
import { joinQaDialogStack } from "../../../src/client/components/QaModal.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../../helpers/attachments.js";
import {
  DEFAULT_SLASH_POLICY,
  DISABLED_SLASH_VIEW,
} from "../../helpers/slash.js";

const events = ["dragenter", "dragover", "dragleave", "drop"] as const;
const host = vi.fn();
afterEach(() => {
  cleanup();
  for (const type of events) document.removeEventListener(type, host);
  host.mockClear();
});

function composer(canSend = true) {
  const changed = vi.fn();
  const view = render(
    <QaComposer
      placeholder="Ask"
      attachments={[]}
      limits={DEFAULT_ATTACHMENT_LIMITS}
      onAttachmentsChange={changed}
      canSend={canSend}
      canStop={false}
      running={false}
      showStop
      status={null}
      slash={DISABLED_SLASH_VIEW}
      slashPolicy={DEFAULT_SLASH_POLICY}
      onSend={vi.fn(async () => true)}
      onSlashOpen={vi.fn()}
      onStop={vi.fn()}
    />,
  );
  return { changed, ...view };
}

function fileDrag(
  type: (typeof events)[number],
  target: Element | Document = document.body,
) {
  // During hover browsers protect file contents but still advertise Files.
  const data = {
    types: ["Files"],
    files:
      type === "drop"
        ? [new File(["demo"], "demo.txt", { type: "text/plain" })]
        : [],
    dropEffect: "none",
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: data });
  fireEvent(target, event);
  return { event, data };
}

function nativeHost() {
  for (const type of events) document.addEventListener(type, host);
}

describe("QA file drop ownership", () => {
  it("claims file drags before the Host overlay and attaches a page-wide drop once", async () => {
    nativeHost();
    const { changed } = composer();
    const zone = screen.getByTestId("qa-composer-drop-zone");
    expect(fileDrag("dragenter").event.defaultPrevented).toBe(true);
    expect(zone.className).toContain("--drag");
    expect(fileDrag("dragover").data.dropEffect).toBe("copy");
    fileDrag("dragleave");
    expect(zone.className).not.toContain("--drag");
    fileDrag("dragenter");
    fileDrag("drop");
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(changed.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: "file", name: "demo.txt" }),
    ]);
    expect(zone.className).not.toContain("--drag");
    expect(host).not.toHaveBeenCalled();
  });

  it("does not duplicate drops on the input's nested DOM", async () => {
    const { changed } = composer();
    fileDrag("drop", screen.getByLabelText("Задать вопрос"));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("keeps the highlight while crossing nested children and resets on cancellation", () => {
    composer();
    const zone = screen.getByTestId("qa-composer-drop-zone");
    fileDrag("dragenter", zone);
    fileDrag("dragenter", screen.getByLabelText("Задать вопрос"));
    fileDrag("dragleave", screen.getByLabelText("Задать вопрос"));
    expect(zone.className).toContain("--drag");
    fireEvent(window, new Event("dragend"));
    expect(zone.className).not.toContain("--drag");
  });

  it("does not attach files behind an open QA dialog", () => {
    const { changed } = composer();
    const dialog = joinQaDialogStack();
    try {
      expect(fileDrag("dragover").data.dropEffect).toBe("none");
      fileDrag("drop");
      expect(changed).not.toHaveBeenCalled();
    } finally {
      dialog.leave();
    }
  });

  it("leaves ordinary text and history drags with their original receivers", () => {
    nativeHost();
    const { changed } = composer();
    for (const type of events) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { types: ["text/plain"], files: [] },
      });
      fireEvent(screen.getByTestId("qa-composer-drop-zone"), event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(host).toHaveBeenCalledTimes(events.length);
    expect(changed).not.toHaveBeenCalled();
  });

  it("blocks a file drop when the composer is disabled and gives ownership back on unmount", () => {
    nativeHost();
    const { changed, unmount } = composer(false);
    expect(fileDrag("dragover").data.dropEffect).toBe("none");
    fileDrag("drop");
    expect(changed).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
    unmount();
    expect(fileDrag("dragenter").event.defaultPrevented).toBe(false);
    expect(host).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "routes a form drop to its own receiver (disabled=%s)",
    (disabled) => {
      nativeHost();
      const { changed } = composer();
      const upload = vi.fn();
      render(
        <QaFormItem
          item={{
            id: "files",
            title: "Files",
            files: {
              requirement: "optional",
              max_count: 2,
              max_file_size_bytes: 1048576,
              accept: [".txt"],
            },
          }}
          answer={null}
          files={[]}
          uploads={[]}
          disabled={disabled}
          onAnswer={vi.fn()}
          onUpload={upload}
          onRemove={vi.fn()}
          onCancel={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
      fileDrag(
        "dragenter",
        screen.getByLabelText("Прикрепить файлы: Files"),
      );
      const { event } = fileDrag(
        "drop",
        screen.getByLabelText("Прикрепить файлы: Files"),
      );
      expect(event.defaultPrevented).toBe(true);
      expect(upload).toHaveBeenCalledTimes(disabled ? 0 : 1);
      expect(changed).not.toHaveBeenCalled();
      expect(host).not.toHaveBeenCalled();
    },
  );
});
