import JSZip from "jszip";
import path from "node:path";
import { parseXml, type XmlElement } from "../comparison/ooxml/xml.js";
import { invalid, checkSignal, validateXlsx } from "./guards.js";
import type { SpreadsheetCellInput } from "./types.js";
import { createCell } from "./workbook.js";

export interface CellEdit {
  sheet: string;
  address: string;
  row: number;
  column: number;
  value: SpreadsheetCellInput;
}
const elements = (node: XmlElement) =>
  node.children.filter(
    (child): child is XmlElement => child.kind === "element",
  );
function escape(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      invalid("Cell text contains characters unsupported by XML 1.0");
  }
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/\r/gu, "&#13;");
}
type Replacement = { start: number; end: number; text: string };
interface DateContext {
  date1904: boolean;
  style(base: number, withTime: boolean): number;
}
function replace(source: string, changes: Replacement[]): string {
  // Coalesce insertions so several new cells at one boundary retain column order.
  const groups = new Map<string, Replacement>();
  for (const change of changes) {
    const key = `${change.start}:${change.end}`;
    const prior = groups.get(key);
    if (prior && change.start === change.end) prior.text += change.text;
    else groups.set(key, { ...change });
  }
  const chunks: string[] = [];
  let cursor = 0;
  for (const change of [...groups.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (change.start < cursor) invalid("Overlapping XML edit spans");
    chunks.push(source.slice(cursor, change.start), change.text);
    cursor = change.end;
  }
  chunks.push(source.slice(cursor));
  return chunks.join("");
}
function replacement(node: XmlElement, text: string): Replacement {
  return { start: node.sourceRange!.start, end: node.sourceRange!.end, text };
}
function prefix(node: XmlElement): string {
  return node.qname.includes(":")
    ? node.qname.slice(0, node.qname.indexOf(":") + 1)
    : "";
}
function opening(node: XmlElement, attributes = node.attributes): string {
  return `<${node.qname}${[...attributes].map(([k, v]) => ` ${k}="${escape(v)}"`).join("")}>`;
}
function cellXml(
  edit: CellEdit,
  previous: XmlElement | undefined,
  xml: string,
  p: string,
  dates: DateContext,
) {
  const value = createCell(edit.value);
  const attrs = new Map(previous?.attributes ?? []);
  attrs.set("r", edit.address);
  attrs.delete("t");
  const qname = previous?.qname ?? `${p}c`;
  const cp = previous ? prefix(previous) : p;
  const tag = (name: string, content: string) =>
    `<${cp}${name}>${content}</${cp}${name}>`;
  let content = "";
  if (typeof value === "string") {
    attrs.set("t", "inlineStr");
    content = tag(
      "is",
      `<${cp}t xml:space="preserve">${escape(value)}</${cp}t>`,
    );
  } else if (typeof value === "number") content = tag("v", String(value));
  else if (typeof value === "boolean") {
    attrs.set("t", "b");
    content = tag("v", value ? "1" : "0");
  } else if (value instanceof Date) {
    attrs.set(
      "s",
      String(
        dates.style(
          Number(attrs.get("s") ?? 0),
          value.toISOString().slice(11) !== "00:00:00.000Z",
        ),
      ),
    );
    content = tag(
      "v",
      String(25569 + value.getTime() / 86400000 - (dates.date1904 ? 1462 : 0)),
    );
  } else if (
    value !== null &&
    typeof value === "object" &&
    "formula" in value
  ) {
    content = tag("f", escape(value.formula!));
    if (value.result !== undefined) {
      if (typeof value.result === "string") attrs.set("t", "str");
      else if (typeof value.result === "boolean") attrs.set("t", "b");
      content += tag(
        "v",
        escape(
          typeof value.result === "boolean"
            ? value.result
              ? "1"
              : "0"
            : String(value.result),
        ),
      );
    }
  }
  // Retain extensions and metadata children belonging to this cell.
  if (previous)
    for (const child of elements(previous)) {
      if (!["f", "v", "is"].includes(child.name))
        content += xml.slice(child.sourceRange!.start, child.sourceRange!.end);
    }
  return `<${qname}${[...attrs].map(([k, v]) => ` ${k}="${escape(v)}"`).join("")}>${content}</${qname}>`;
}
function editRow(
  xml: string,
  row: XmlElement,
  edits: CellEdit[],
  dates: DateContext,
): string {
  const range = row.sourceRange!;
  const cells = elements(row).filter((n) => n.name === "c");
  const changes: Replacement[] = [];
  for (const edit of edits) {
    const cell = cells.find((n) => n.attributes.get("r") === edit.address);
    const text = cellXml(edit, cell, xml, prefix(row), dates);
    if (cell) changes.push(replacement(cell, text));
    else {
      const after = cells.find(
        (n) => columnOf(n.attributes.get("r") ?? "") > edit.column,
      );
      const position = after?.sourceRange!.start ?? range.endTagStart;
      changes.push({ start: position, end: position, text });
    }
  }
  if (range.startTagEnd === range.end)
    return (
      opening(row) +
      edits
        .map((e) => cellXml(e, undefined, xml, prefix(row), dates))
        .join("") +
      `</${row.qname}>`
    );
  return replace(
    xml.slice(range.start, range.end),
    changes.map((change) => ({
      ...change,
      start: change.start - range.start,
      end: change.end - range.start,
    })),
  );
}
function columnOf(address: string): number {
  return [...address.replace(/[0-9]/gu, "")].reduce(
    (n, c) => n * 26 + c.charCodeAt(0) - 64,
    0,
  );
}
function intersects(edit: CellEdit, range: string): boolean {
  const ends = range.replace(/\$/gu, "").split(":");
  const start = ends[0]!,
    end = ends[1] ?? start;
  return (
    edit.row >= Number(start.replace(/[A-Z]/gu, "")) &&
    edit.row <= Number(end.replace(/[A-Z]/gu, "")) &&
    edit.column >= columnOf(start) &&
    edit.column <= columnOf(end)
  );
}
function editSheet(xml: string, edits: CellEdit[], dates: DateContext): string {
  const root = elements(parseXml(xml, true)).find(
    (n) => n.name === "worksheet",
  );
  if (!root) invalid("Worksheet XML is unsupported");
  if (elements(root).some((n) => n.name === "sheetProtection"))
    invalid("Protected worksheets cannot be edited");
  const data = elements(root).find((n) => n.name === "sheetData");
  if (!data) invalid("Worksheet has no sheetData element");
  const rows = elements(data).filter((n) => n.name === "row");
  const rowIds = rows.map((row) => row.attributes.get("r"));
  if (rowIds.some((id) => !id) || new Set(rowIds).size !== rowIds.length)
    invalid("Editing implicit or duplicate worksheet rows is unsupported");
  for (const row of rows) {
    const cells = elements(row).filter((n) => n.name === "c");
    const addresses = cells.map((cell) => cell.attributes.get("r") ?? "");
    if (
      addresses.some(
        (address) =>
          !/^[A-Z]+[1-9][0-9]*$/u.test(address) ||
          Number(address.replace(/[A-Z]/gu, "")) !==
            Number(row.attributes.get("r")),
      ) ||
      new Set(addresses).size !== addresses.length
    )
      invalid(
        "Editing implicit, duplicate or misplaced cell addresses is unsupported",
      );
  }
  for (const row of rows)
    for (const cell of elements(row))
      for (const formula of elements(cell)) {
        if (
          formula.name === "f" &&
          formula.attributes.has("t") &&
          formula.attributes.get("t") !== "normal"
        ) {
          const ref =
            formula.attributes.get("ref") ?? cell.attributes.get("r")!;
          if (edits.some((e) => intersects(e, ref)))
            invalid(
              "Editing shared, array or data-table formula ranges is unsupported",
            );
        }
      }
  for (const merged of elements(root)
    .filter((n) => n.name === "mergeCells")
    .flatMap(elements)) {
    const ref = merged.attributes.get("ref")!;
    if (
      edits.some((e) => intersects(e, ref) && e.address !== ref.split(":")[0])
    )
      invalid("Edit only the top-left cell of a merged range");
  }
  const changes: Replacement[] = [];
  const byRow = new Map<number, CellEdit[]>();
  for (const edit of edits)
    byRow.set(edit.row, [...(byRow.get(edit.row) ?? []), edit]);
  for (const [number, cells] of [...byRow].sort(([a], [b]) => a - b)) {
    cells.sort((a, b) => a.column - b.column);
    const row = rows.find((n) => Number(n.attributes.get("r")) === number);
    if (row) changes.push(replacement(row, editRow(xml, row, cells, dates)));
    else {
      const p = prefix(data),
        qname = `${p}row`;
      const text = `<${qname} r="${number}">${cells.map((e) => cellXml(e, undefined, xml, p, dates)).join("")}</${qname}>`;
      const after = rows.find((n) => Number(n.attributes.get("r")) > number);
      const position =
        after?.sourceRange!.start ?? data.sourceRange!.endTagStart;
      changes.push({ start: position, end: position, text });
    }
  }
  if (data.sourceRange!.startTagEnd === data.sourceRange!.end) {
    const text =
      opening(data) + changes.map((c) => c.text).join("") + `</${data.qname}>`;
    changes.splice(0, changes.length, replacement(data, text));
  }
  // Omitting the optional dimension lets readers derive the expanded used range.
  const dimension = elements(root).find((n) => n.name === "dimension");
  if (dimension) changes.push(replacement(dimension, ""));
  return replace(xml, changes);
}

/** Preserve all package parts except targeted sheets and calculation housekeeping. */
export async function editXlsx(
  bytes: Buffer,
  edits: CellEdit[],
  signal?: AbortSignal,
): Promise<Buffer> {
  validateXlsx(bytes, signal);
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).some((n) => n.startsWith("_xmlsignatures/")))
    invalid(
      "Signed workbooks cannot be edited without invalidating signatures",
    );
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) invalid("Workbook relationship points to a missing part");
    return file.async("string");
  };
  const workbookXml = await read("xl/workbook.xml");
  const workbook = elements(parseXml(workbookXml, true)).find(
    (n) => n.name === "workbook",
  )!;
  const sheets = elements(workbook)
    .filter((n) => n.name === "sheets")
    .flatMap(elements);
  const relXml = await read("xl/_rels/workbook.xml.rels");
  const relationships = elements(parseXml(relXml, true))[0]!;
  const rels = elements(relationships);
  const hasDates = edits.some(
    (e) => e.value !== null && typeof e.value === "object" && "date" in e.value,
  );
  const styleXml = hasDates ? await read("xl/styles.xml") : "";
  const styleRoot = hasDates
    ? elements(parseXml(styleXml, true))[0]
    : undefined;
  const xfs =
    styleRoot && elements(styleRoot).find((n) => n.name === "cellXfs");
  const existingStyles = xfs ? elements(xfs) : [];
  const addedStyles: string[] = [];
  const styleIds = new Map<string, number>();
  const date1904 = elements(workbook)
    .find((n) => n.name === "workbookPr")
    ?.attributes.get("date1904");
  const dates: DateContext = {
    date1904: date1904 === "1" || date1904 === "true",
    style(base, withTime) {
      const key = `${base}:${withTime}`;
      const known = styleIds.get(key);
      if (known !== undefined) return known;
      const original = existingStyles[base];
      if (!original)
        invalid("Date editing requires an existing base cell style");
      const attrs = new Map(original.attributes);
      attrs.set("numFmtId", withTime ? "22" : "14");
      attrs.set("applyNumberFormat", "1");
      const range = original.sourceRange!;
      const content =
        range.startTagEnd === range.end
          ? ""
          : styleXml.slice(range.startTagEnd, range.endTagStart);
      const id = existingStyles.length + addedStyles.length;
      addedStyles.push(
        opening(original, attrs) + content + `</${original.qname}>`,
      );
      styleIds.set(key, id);
      return id;
    },
  };
  for (const name of new Set(edits.map((e) => e.sheet))) {
    checkSignal(signal);
    const sheet = sheets.find((n) => n.attributes.get("name") === name);
    if (!sheet) invalid("Worksheet not found; inspect exact sheet names first");
    const id = [...sheet.attributes].find(([k]) => k.endsWith(":id"))?.[1];
    const rel = rels.find((n) => n.attributes.get("Id") === id);
    const target = rel?.attributes.get("Target");
    if (!target || rel?.attributes.get("TargetMode") === "External")
      invalid("Unsupported worksheet relationship");
    const part = path.posix.normalize(
      target.startsWith("/") ? target.slice(1) : `xl/${target}`,
    );
    if (!/^xl\/worksheets\/[^/]+\.xml$/u.test(part))
      invalid("Unsupported worksheet part path");
    const changed = editSheet(
      await read(part),
      edits.filter((e) => e.sheet === name),
      dates,
    );
    parseXml(changed);
    zip.file(part, changed);
  }
  if (addedStyles.length && xfs) {
    const attrs = new Map(xfs.attributes);
    attrs.set("count", String(existingStyles.length + addedStyles.length));
    const range = xfs.sourceRange!;
    zip.file(
      "xl/styles.xml",
      replace(styleXml, [
        {
          start: range.start,
          end: range.startTagEnd,
          text: opening(xfs, attrs),
        },
        {
          start: range.endTagStart,
          end: range.endTagStart,
          text: addedStyles.join(""),
        },
      ]),
    );
  }
  const calc = elements(workbook).find((n) => n.name === "calcPr");
  const p = prefix(workbook);
  const attrs = new Map(calc?.attributes ?? []);
  attrs.set("fullCalcOnLoad", "1");
  attrs.set("forceFullCalc", "1");
  attrs.set("calcMode", "auto");
  const text = `<${calc?.qname ?? `${p}calcPr`}${[...attrs].map(([k, v]) => ` ${k}="${escape(v)}"`).join("")}/>`;
  // calcPr follows definedNames and precedes later workbook properties.
  const after = elements(workbook).find((n) =>
    [
      "oleSize",
      "customWorkbookViews",
      "pivotCaches",
      "smartTagPr",
      "smartTagTypes",
      "webPublishing",
      "fileRecoveryPr",
      "webPublishObjects",
      "extLst",
    ].includes(n.name),
  );
  const position =
    after?.sourceRange!.start ?? workbook.sourceRange!.endTagStart;
  zip.file(
    "xl/workbook.xml",
    replace(workbookXml, [
      calc ? replacement(calc, text) : { start: position, end: position, text },
    ]),
  );
  const chains = rels.filter((n) =>
    n.attributes.get("Type")?.endsWith("/calcChain"),
  );
  if (chains.length) {
    const typesXml = await read("[Content_Types].xml");
    const types = elements(parseXml(typesXml, true))[0]!;
    const targets = new Set(
      chains.map((n) => {
        const target = n.attributes.get("Target") ?? "";
        return path.posix.normalize(
          target.startsWith("/") ? target.slice(1) : `xl/${target}`,
        );
      }),
    );
    // Reject unusual chains rather than deleting a relationship to an unknown part.
    if (
      chains.some((n) => n.attributes.get("TargetMode") === "External") ||
      [...targets].some((n) => n !== "xl/calcChain.xml")
    )
      invalid("Unsupported calculation chain relationship");
    zip.remove("xl/calcChain.xml");
    zip.file(
      "xl/_rels/workbook.xml.rels",
      replace(
        relXml,
        chains.map((n) => replacement(n, "")),
      ),
    );
    zip.file(
      "[Content_Types].xml",
      replace(
        typesXml,
        elements(types)
          .filter((n) => n.attributes.get("PartName") === "/xl/calcChain.xml")
          .map((n) => replacement(n, "")),
      ),
    );
  }
  const result = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  validateXlsx(result, signal);
  return result;
}
