// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QaSpreadsheetPreview as Preview } from "../../../src/types.js";
import { QaSpreadsheetPreview } from "../../../src/client/components/QaSpreadsheetPreview.js";
import { QaWorkspaceBrowser } from "../../../src/client/components/QaWorkspaceBrowser.js";
import type { QaBoundSourceApi } from "../../../src/client/types.js";

afterEach(cleanup);
function preview(sheet = "Data", startRow = 1, startColumn = 1): Preview {
  const info = {
    name: sheet,
    state: "visible",
    rows: 80,
    columns: 24,
    nonEmptyRows: 80,
    mergedRanges: [],
  };
  return {
    kind: "spreadsheet",
    name: "book.xlsx",
    bytes: 100,
    inventory: {
      filename: "book.xlsx",
      format: "xlsx",
      size: 100,
      sha256: "0".repeat(64),
      warnings: [],
      sheets: [
        { ...info, name: "Data" },
        { ...info, name: "Hidden", state: "hidden" },
      ],
    },
    page: {
      filename: "book.xlsx",
      format: "xlsx",
      sha256: "0".repeat(64),
      sheet: info,
      startRow,
      startColumn,
      nextRow: 41,
      nextColumn: 13,
      warnings: [],
      rows: [
        {
          row: startRow,
          cells: [
            {
              address: `A${startRow}`,
              type: "string",
              value: "<img src=x onerror=alert(1)>",
            },
            {
              address: `B${startRow}`,
              type: "formula",
              value: 2,
              formula: "1+1",
            },
          ],
        },
      ],
    },
  };
}
describe("spreadsheet viewer", () => {
  it("renders literal cells and saved formulas, then requests exact sheets and both page axes", async () => {
    const load = vi.fn(async (selection) =>
      preview(selection.sheet, selection.startRow, selection.startColumn),
    );
    const { container } = render(
      <QaSpreadsheetPreview initial={preview()} load={load} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByTitle("B1: =1+1").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "↓ Строки" }));
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({
        sheet: "Data",
        startRow: 41,
        startColumn: 1,
      }),
    );
    await screen.findByTitle("B41: =1+1");
    fireEvent.click(screen.getByRole("button", { name: "Колонки →" }));
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({
        sheet: "Data",
        startRow: 41,
        startColumn: 13,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(false),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Hidden" },
    });
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({
        sheet: "Hidden",
        startRow: 1,
        startColumn: 1,
      }),
    );
  });
  it("ignores an old response after the file changes and retains the current page on refusal", async () => {
    let resolve!: (value: Preview) => void;
    const load = vi.fn(
      () =>
        new Promise<Preview>((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <QaSpreadsheetPreview initial={preview()} load={load} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "↓ Строки" }));
    view.rerender(
      <QaSpreadsheetPreview initial={preview("Hidden")} load={load} />,
    );
    resolve(preview("Data", 41));
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "Hidden",
      ),
    );
    const refused = vi.fn(async () => {
      throw new Error("(reason: outside-roots)");
    });
    view.rerender(<QaSpreadsheetPreview initial={preview()} load={refused} />);
    fireEvent.click(screen.getByRole("button", { name: "↓ Строки" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "вне каталогов",
    );
    expect(screen.getByTitle("B1: =1+1")).toBeTruthy();
  });
  it("opens a workspace spreadsheet, forwards navigation and displays it in the expanded dialog", async () => {
    const previewWorkspaceDocument = vi.fn(
      async (_session, _path, selection) => ({
        ok: true as const,
        value: preview(
          selection?.sheet,
          selection?.startRow,
          selection?.startColumn,
        ),
      }),
    );
    const api = {
      readWorkspaceFile: async () => ({
        ok: true,
        value: {
          path: "book.xlsx",
          size: 100,
          truncated: false,
          markdown: false,
          renderableMarkdown: false,
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64: "UEs=",
        },
      }),
      listWorkspaceFiles: async () => ({
        ok: true,
        value: { path: "", entries: [], truncated: false },
      }),
      previewWorkspaceDocument,
    } as unknown as QaBoundSourceApi;
    render(
      <QaWorkspaceBrowser sessionId="demo" api={api} initialFile="book.xlsx" />,
    );
    await screen.findByTestId("qa-spreadsheet-preview");
    fireEvent.click(screen.getByRole("button", { name: "↓ Строки" }));
    await waitFor(() =>
      expect(previewWorkspaceDocument).toHaveBeenLastCalledWith(
        "demo",
        "book.xlsx",
        { sheet: "Data", startRow: 41, startColumn: 1 },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Развернуть файл" }));
    expect(
      await screen.findByRole("dialog", { name: "book.xlsx" }),
    ).toBeTruthy();
  });
});
