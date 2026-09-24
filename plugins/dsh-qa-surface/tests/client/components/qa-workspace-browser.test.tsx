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
    expect(await screen.findByText(".qa")).toBeTruthy();
    expect(screen.getByText("note.txt")).toBeTruthy();
    expect(screen.getByText("12 Б")).toBeTruthy();
    expect(listWorkspaceFiles).toHaveBeenCalledWith("s1", "");
    fireEvent.click(screen.getByText(".qa"));
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
    fireEvent.click(await screen.findByText("guide.md"));
    expect(await screen.findByRole("heading", { name: "Guide" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Показать исходником" }),
    );
    await waitFor(() => expect(screen.getByText("# Guide")).toBeTruthy());
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
    fireEvent.click(await screen.findByText("report.docx"));
    expect(await screen.findByText(/не читается как текст/u)).toBeTruthy();
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
    fireEvent.click(await screen.findByText("guide.md"));
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
    fireEvent.click(await screen.findByText("report.pdf"));
    await waitFor(() =>
      expect(document.querySelector("iframe.dsh-qa-ws__pdf")).toBeTruthy(),
    );
    const frame = document.querySelector(
      "iframe.dsh-qa-ws__pdf",
    ) as HTMLIFrameElement;
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
    fireEvent.click(await screen.findByText("report.docx"));
    await waitFor(() =>
      expect(document.querySelector("iframe.dsh-qa-ws__pdf")).toBeTruthy(),
    );
    expect(previewWorkspaceDocument).toHaveBeenCalledWith("s1", "report.docx");
    const frame = document.querySelector(
      "iframe.dsh-qa-ws__pdf",
    ) as HTMLIFrameElement;
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
    fireEvent.click(await screen.findByText("report.docx"));
    expect(await screen.findByText(/не открывается в панели/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скачать" })).toBeTruthy();
  });

  it("explains a refusal that leaves the chat's own tree", async () => {
    render(
      <QaWorkspaceBrowser
        sessionId="s1"
        api={api({ listWorkspaceFiles: refused("outside-roots") })}
      />,
    );
    expect(
      await screen.findByText(
        /лежит вне каталогов, доступных для предпросмотра/u,
      ),
    ).toBeTruthy();
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
    expect(await screen.findByText("Каталог пуст.")).toBeTruthy();
  });
});
