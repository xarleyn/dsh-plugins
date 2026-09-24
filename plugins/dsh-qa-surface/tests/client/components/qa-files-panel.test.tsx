// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QaChatFileGroup } from "../../../src/client/chat-files.js";
import { QaFilesPanel } from "../../../src/client/components/QaFilesPanel.js";

const groups: readonly QaChatFileGroup[] = [
  {
    messageId: "user:2",
    timestamp: Date.UTC(2026, 8, 13, 10, 30),
    files: [],
    images: [{ attachmentId: "img-1", mediaType: "image/png" }],
  },
  {
    messageId: "user:1",
    timestamp: Date.UTC(2026, 8, 13, 9, 0),
    files: [{ attachmentId: "file-1", name: "notes.md", bytes: 2048 }],
    images: [],
  },
];

describe("files panel", () => {
  it("renders one section per message with the sent file handle", () => {
    render(<QaFilesPanel groups={groups} onJumpToMessage={vi.fn()} />);
    const badges = document.querySelectorAll(".dsh-qa-files__group");
    expect(badges).toHaveLength(2);
    const card = screen.getByText("notes.md");
    expect(card).toBeTruthy();
    expect(screen.getByText("2 КБ")).toBeTruthy();
  });

  it("resolves image thumbnails through the asset repository", async () => {
    const resolveImage = vi.fn(async () => "blob:resolved");
    render(
      <QaFilesPanel
        groups={groups}
        resolveImage={resolveImage}
        onJumpToMessage={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector("img.dsh-qa-files__thumb")).toBeTruthy(),
    );
    expect(resolveImage).toHaveBeenCalledWith("img-1");
    const thumb = document.querySelector(
      "img.dsh-qa-files__thumb",
    ) as HTMLImageElement;
    expect(thumb.src).toBe("blob:resolved");
  });

  it("jumps to the sending message", () => {
    const onJumpToMessage = vi.fn();
    render(<QaFilesPanel groups={groups} onJumpToMessage={onJumpToMessage} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: /Перейти к сообщению/u })[1]!,
    );
    expect(onJumpToMessage).toHaveBeenCalledWith("user:1");
  });

  it("shows the empty state for attachment-free chats", () => {
    render(<QaFilesPanel groups={[]} onJumpToMessage={vi.fn()} />);
    expect(screen.getByText("В этом чате нет вложений.")).toBeTruthy();
  });
});
