// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    expect(screen.getAllByTestId("qa-files-group")).toHaveLength(2);
    const chip = screen.getByTestId("qa-file");
    expect(within(chip).getByTestId("qa-file-name").textContent).toBe(
      "notes.md",
    );
    expect(within(chip).getByTestId("qa-file-size").textContent).toBe("2 КБ");
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
      expect(screen.getByTestId("qa-files-thumb")).toBeTruthy(),
    );
    expect(resolveImage).toHaveBeenCalledWith("img-1");
    const thumb = screen.getByTestId("qa-files-thumb");
    expect((thumb as HTMLImageElement).src).toBe("blob:resolved");
  });

  it("jumps to the sending message", () => {
    const onJumpToMessage = vi.fn();
    render(<QaFilesPanel groups={groups} onJumpToMessage={onJumpToMessage} />);
    const [, second] = screen.getAllByTestId("qa-files-jump");
    expect(second?.getAttribute("aria-label")).toMatch(/Перейти к сообщению/u);
    fireEvent.click(second!);
    expect(onJumpToMessage).toHaveBeenCalledWith("user:1");
  });

  it("shows the empty state for attachment-free chats", () => {
    render(<QaFilesPanel groups={[]} onJumpToMessage={vi.fn()} />);
    expect(screen.getByTestId("qa-files-empty")).toBeTruthy();
  });

  it("lists a document the answer produced, and opens it on request", () => {
    const onArtifactOpen = vi.fn();
    render(
      <QaFilesPanel
        groups={[
          {
            messageId: "assistant:1",
            timestamp: Date.UTC(2026, 8, 13, 11, 0),
            files: [],
            images: [],
            artifacts: [
              {
                path: ".qa/artifacts/documents/doc_1/report.docx",
                name: "report.docx",
                format: "docx",
                bytes: 12_595,
              },
            ],
          },
        ]}
        onJumpToMessage={vi.fn()}
        onArtifactOpen={onArtifactOpen}
      />,
    );
    // The roster is no longer the empty chat it was: a produced file belongs to
    // the conversation the same way a sent one does.
    expect(screen.queryByTestId("qa-files-empty")).toBeNull();
    expect(
      within(screen.getByTestId("qa-files-group-items")).getByTestId(
        "qa-file-name",
      ).textContent,
    ).toBe("report.docx");
    fireEvent.click(
      screen.getByRole("button", { name: "Открыть report.docx" }),
    );
    expect(onArtifactOpen).toHaveBeenCalledWith({
      path: ".qa/artifacts/documents/doc_1/report.docx",
      name: "report.docx",
      format: "docx",
      bytes: 12_595,
    });
  });
});
