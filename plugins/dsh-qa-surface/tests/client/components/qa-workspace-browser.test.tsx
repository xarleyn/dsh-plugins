// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QaWorkspaceListing } from "../../../src/types.js";
import type { QaBoundSourceApi } from "../../../src/client/types.js";
import { QaWorkspaceBrowser } from "../../../src/client/components/QaWorkspaceBrowser.js";

/** One successful listing answer. */
function listing(value: QaWorkspaceListing) {
  return async () => ({ ok: true as const, value });
}

/** One refused call, spelled the way the Host folds the reason into the wire. */
function refused(reason: string) {
  return async () => ({
    ok: false as const,
    error: new Error(
      `QA source preview refused the request (reason: ${reason})`,
    ),
  });
}

/** A bound API whose two browse calls are the test's own stubs. */
function api(overrides: Partial<QaBoundSourceApi>): QaBoundSourceApi {
  return {
    sources: async () => ({ ok: true as const, value: [] }),
    readSourceFile: refused("unavailable"),
    listWorkspaceFiles: refused("unavailable"),
    readWorkspaceFile: refused("unavailable"),
    previewWorkspaceDocument: refused("unsupported"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace browser", () => {
  it("lists the chat root and descends into a directory", async () => {
    const listWorkspaceFiles = vi.fn(
      listing({
        path: "",
        truncated: false,
        entries: [
          { name: ".qa", type: "directory", size: null },
          { name: "note.txt", type: "file", size: 12 },
        ],
      }),
    );
    render(
      <QaWorkspaceBrowser sessionId="s1" api={api({ listWorkspaceFiles })} />,
    );
    const names = await screen.findAllByTestId(
      "qa-surface-workspace-entry-name",
    );
    expect(names.map((node) => node.textContent)).toEqual([".qa", "note.txt"]);
    expect(
      screen.getByTestId("qa-surface-workspace-entry-size").textContent,
    ).toBe("12 Б");
    expect(listWorkspaceFiles).toHaveBeenCalledWith("s1", "");
    const entries = screen.getAllByTestId("qa-surface-workspace-entry");
    fireEvent.click(entries[0]!);
    await waitFor(() =>
      expect(listWorkspaceFiles).toHaveBeenLastCalledWith("s1", ".qa"),
    );
  });

  it("opens a text file and toggles a Markdown body between rendered and raw", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      value: {
        path: "docs/guide.md",
        size: 9,
        truncated: false,
        markdown: true,
        renderableMarkdown: true,
        mime: "text/markdown",
        text: "# Guide\n",
      },
    }));
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "guide.md", type: "file", size: 9 }],
          }),
          readWorkspaceFile,
        })}
      />,
    );
    const guide = await screen.findByTestId("qa-surface-workspace-entry-name");
    expect(guide.textContent).toBe("guide.md");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    expect(await screen.findByRole("heading", { name: "Guide" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Показать исходником" }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-surface-workspace-text").textContent,
      ).toContain("# Guide"),
    );
  });

  it("offers a binary file as a download instead of previewing it", async () => {
    const createObjectURL = vi.fn(() => "blob:file");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "report.docx", type: "file", size: 4 }],
          }),
          readWorkspaceFile: async () => ({
            ok: true as const,
            value: {
              path: "report.docx",
              size: 4,
              truncated: false,
              markdown: false,
              renderableMarkdown: false,
              mime: "application/octet-stream",
              base64: "UEsAAQ==",
            },
          }),
        })}
      />,
    );
    const row = await screen.findByTestId("qa-surface-workspace-entry-name");
    expect(row.textContent).toBe("report.docx");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-surface-workspace-status").textContent,
      ).toContain("не читается как текст"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file");
  });

  it("opens the same file in an expanded dialog and closes it", async () => {
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "guide.md", type: "file", size: 9 }],
          }),
          readWorkspaceFile: async () => ({
            ok: true as const,
            value: {
              path: "guide.md",
              size: 9,
              truncated: false,
              markdown: true,
              renderableMarkdown: true,
              mime: "text/markdown",
              text: "# Guide\n",
            },
          }),
        })}
      />,
    );
    const opened = await screen.findByTestId("qa-surface-workspace-entry-name");
    expect(opened.textContent).toBe("guide.md");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Развернуть файл" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "guide.md" });
    expect(dialog.className).toBe("dsh-qa-modal");
    expect(within(dialog).getByRole("heading", { name: "Guide" })).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть файл" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders a PDF through the browser viewer instead of a text guess", async () => {
    const createObjectURL = vi.fn(() => "blob:pdf");
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "report.pdf", type: "file", size: 4 }],
          }),
          readWorkspaceFile: async () => ({
            ok: true as const,
            value: {
              path: "report.pdf",
              size: 4,
              truncated: false,
              markdown: false,
              renderableMarkdown: false,
              mime: "application/pdf",
              base64: "JVBERi0=",
            },
          }),
        })}
      />,
    );
    const listed = await screen.findByTestId("qa-surface-workspace-entry-name");
    expect(listed.textContent).toBe("report.pdf");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    await waitFor(() =>
      expect(screen.getByTestId("qa-surface-workspace-pdf")).toBeTruthy(),
    );
    const frame = screen.getByTestId("qa-surface-workspace-pdf");
    expect(frame.getAttribute("src")).toBe("blob:pdf");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("asks the Host to render a Word document instead of guessing at bytes", async () => {
    const previewWorkspaceDocument = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: "pdf" as const,
        base64: "JVBERi0=",
        mime: "application/pdf" as const,
        name: "report.docx",
        bytes: 8,
      },
    }));
    const createObjectURL = vi.fn(() => "blob:converted");
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "report.docx", type: "file", size: 4 }],
          }),
          readWorkspaceFile: async () => ({
            ok: true as const,
            value: {
              path: "report.docx",
              size: 4,
              truncated: false,
              markdown: false,
              renderableMarkdown: false,
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              base64: "UEsAAQ==",
            },
          }),
          previewWorkspaceDocument,
        })}
      />,
    );
    const word = await screen.findByTestId("qa-surface-workspace-entry-name");
    expect(word.textContent).toBe("report.docx");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    await waitFor(() =>
      expect(screen.getByTestId("qa-surface-workspace-pdf")).toBeTruthy(),
    );
    expect(previewWorkspaceDocument).toHaveBeenCalledWith("s1", "report.docx");
    const frame = screen.getByTestId("qa-surface-workspace-pdf");
    expect(frame.getAttribute("src")).toBe("blob:converted");
  });

  it("keeps the download and says why when the conversion is refused", async () => {
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "",
            truncated: false,
            entries: [{ name: "report.docx", type: "file", size: 4 }],
          }),
          readWorkspaceFile: async () => ({
            ok: true as const,
            value: {
              path: "report.docx",
              size: 4,
              truncated: false,
              markdown: false,
              renderableMarkdown: false,
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              base64: "UEsAAQ==",
            },
          }),
        })}
      />,
    );
    const refusedEntry = await screen.findByTestId(
      "qa-surface-workspace-entry-name",
    );
    expect(refusedEntry.textContent).toBe("report.docx");
    fireEvent.click(screen.getByTestId("qa-surface-workspace-entry"));
    await waitFor(() =>
      expect(
        screen.getByTestId("qa-surface-workspace-status").textContent,
      ).toContain("не открывается в панели"),
    );
    expect(screen.getByRole("button", { name: "Скачать" })).toBeTruthy();
  });

  it("explains a refusal that leaves the chat's own tree", async () => {
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({ listWorkspaceFiles: refused("outside-roots") })}
      />,
    );
    const status = await screen.findByTestId("qa-surface-workspace-status");
    expect(status.textContent).toMatch(
      /лежит вне каталогов, доступных для предпросмотра/u,
    );
  });

  it("says an empty directory is empty rather than showing nothing", async () => {
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({
          listWorkspaceFiles: listing({
            path: "docs",
            truncated: false,
            entries: [],
          }),
        })}
      />,
    );
    const status = await screen.findByTestId("qa-surface-workspace-status");
    expect(status.textContent).toBe("Каталог пуст.");
  });

  it("opens the file a card arrived with, instead of the listing", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      value: {
        path: ".qa/artifacts/documents/doc_1/report.docx",
        size: 12_595,
        truncated: false,
        markdown: false,
        renderableMarkdown: false,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    }));
    const previewWorkspaceDocument = vi.fn(refused("unsupported"));
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({ readWorkspaceFile, previewWorkspaceDocument })}
        initialFile=".qa/artifacts/documents/doc_1/report.docx"
      />,
    );
    // The arrival is the point of the card under an answer: the reader lands on
    // the document, not on a directory they have to walk into.
    await waitFor(() =>
      expect(readWorkspaceFile).toHaveBeenCalledWith(
        "s1",
        ".qa/artifacts/documents/doc_1/report.docx",
      ),
    );
    const preview = await screen.findByTestId("qa-surface-workspace-preview");
    expect(
      within(preview).getByTestId("qa-surface-workspace-preview-name")
        .textContent,
    ).toBe("report.docx");
    // A Word file asks the Host for the copy the browser can draw.
    await waitFor(() =>
      expect(previewWorkspaceDocument).toHaveBeenCalledWith(
        "s1",
        ".qa/artifacts/documents/doc_1/report.docx",
      ),
    );
  });
});
