import { useEffect, useRef, useState } from "react";
import type {
  QaSpreadsheetPreview as Preview,
  QaSpreadsheetPreviewSelection as Selection,
} from "../../types.js";
import { sourcePreviewFailureCopy } from "../source-preview.js";

export interface QaSpreadsheetPreviewProps {
  readonly initial: Preview;
  readonly load: (selection: Selection) => Promise<Preview>;
}

/** Read-only cells, with explicit paging on both axes and no formula execution. */
export function QaSpreadsheetPreview({
  initial,
  load,
}: QaSpreadsheetPreviewProps) {
  const [preview, setPreview] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setPreview(initial);
    setBusy(false);
    setFailure("");
    return () => {
      generation.current += 1;
    };
  }, [initial]);
  const { page, inventory } = preview;
  const open = async (selection: Selection) => {
    const current = ++generation.current;
    setBusy(true);
    setFailure("");
    try {
      const next = await load(selection);
      if (generation.current === current) setPreview(next);
    } catch (error) {
      if (generation.current === current)
        setFailure(sourcePreviewFailureCopy(error));
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  const move = (startRow: number, startColumn: number) => {
    void open({ sheet: page.sheet.name, startRow, startColumn });
  };
  const columns = page.rows[0]?.cells ?? [];
  return (
    <section
      className="dsh-qa-sheet"
      data-testid="qa-spreadsheet-preview"
      aria-label={`Таблица ${preview.name}`}
      aria-busy={busy}
    >
      <div className="dsh-qa-sheet__controls">
        <label>
          Лист{" "}
          <select
            aria-label="Лист книги"
            value={page.sheet.name}
            disabled={busy}
            onChange={(event) => {
              void open({
                sheet: event.target.value,
                startRow: 1,
                startColumn: 1,
              });
            }}
          >
            {inventory.sheets.map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name}
                {sheet.state === "visible" ? "" : " (скрытый)"}
              </option>
            ))}
          </select>
        </label>
        <span>
          {page.sheet.rows} строк · {page.sheet.columns} колонок
        </span>
      </div>
      <div className="dsh-qa-sheet__controls" aria-label="Навигация по таблице">
        <button
          type="button"
          disabled={busy || page.startRow <= 1}
          onClick={() =>
            move(Math.max(1, page.startRow - 40), page.startColumn)
          }
        >
          ↑ Строки
        </button>
        <button
          type="button"
          disabled={busy || page.nextRow === null}
          onClick={() => move(page.nextRow ?? 1, page.startColumn)}
        >
          ↓ Строки
        </button>
        <button
          type="button"
          disabled={busy || page.startColumn <= 1}
          onClick={() =>
            move(page.startRow, Math.max(1, page.startColumn - 12))
          }
        >
          ← Колонки
        </button>
        <button
          type="button"
          disabled={busy || page.nextColumn === null}
          onClick={() => move(page.startRow, page.nextColumn ?? 1)}
        >
          Колонки →
        </button>
        <span>
          {page.rows.length === 0
            ? "Пустой лист"
            : `${columns[0]?.address ?? ""}–${page.rows.at(-1)?.cells.at(-1)?.address ?? ""}`}
        </span>
      </div>
      <p className="dsh-qa-sheet__note">
        Формулы: сохранённые результаты без пересчёта. Формула видна при
        наведении на ячейку. Оформление, графики и объединение ячеек не
        воспроизводятся.
      </p>
      {failure === "" ? null : <p role="alert">{failure}</p>}
      {busy ? <p role="status">Читаю ячейки…</p> : null}
      <div className="dsh-qa-sheet__scroll">
        <table>
          <caption className="dsh-qa-sheet__caption">{page.sheet.name}</caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              {columns.map((cell) => (
                <th scope="col" key={cell.address}>
                  {cell.address.replace(/\d+$/u, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.row}>
                <th scope="row">{row.row}</th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.address}
                    data-type={cell.type}
                    title={`${cell.address}${cell.formula === undefined ? "" : `: =${cell.formula}`}${cell.numberFormat === undefined ? "" : ` (${cell.numberFormat})`}`}
                  >
                    {cell.value === null
                      ? ""
                      : cell.type === "date" && typeof cell.value === "string"
                        ? cell.value.replace(/T00:00:00\.000Z$/u, "")
                        : String(cell.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
