// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QaComposer } from "../src/client/components/QaComposer.js";
import type { QaAttachmentDraft } from "../src/types.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./helpers/attachments.js";
import { DISABLED_SLASH_VIEW, DEFAULT_SLASH_POLICY } from "./helpers/slash.js";

const LIMITS = DEFAULT_ATTACHMENT_LIMITS;

describe("QA message", () => {
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
        slash={DISABLED_SLASH_VIEW}
        slashPolicy={DEFAULT_SLASH_POLICY}
        onSend={vi.fn(async () => true)}
        onSlashOpen={vi.fn()}
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
        slash={DISABLED_SLASH_VIEW}
        slashPolicy={DEFAULT_SLASH_POLICY}
        onSlashOpen={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const input2 = screen.getByLabelText("Задать вопрос");
    fireEvent.change(input2, { target: { value: "Смотри" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("Смотри", drafts, null),
    );
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
        slash={DISABLED_SLASH_VIEW}
        slashPolicy={DEFAULT_SLASH_POLICY}
        onSend={vi.fn(async () => true)}
        onSlashOpen={vi.fn()}
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
      expect(screen.getByRole("alert").textContent).toContain(".exe"),
    );
  });
});
