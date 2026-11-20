import JSZip from "jszip";
import { parseXml, type XmlElement } from "../comparison/ooxml/xml.js";
import { checkSignal, validateXlsx } from "./guards.js";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PREFIXED_MAIN =
  /xmlns:[\w.-]+\s*=\s*["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/u;

/** ExcelJS matches literal tag names. Project only SpreadsheetML element
 * names into the vocabulary it reads. Keep all text and attribute bytes
 * intact, including literal markup in comments, strings and formulas. */
function excelJsTags(xml: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  function omit(offset: number, length: number) {
    chunks.push(xml.slice(cursor, offset));
    cursor = offset + length;
  }
  function visit(node: XmlElement, inherited: ReadonlySet<string>) {
    let local: Set<string> | undefined;
    for (const [name, uri] of node.attributes) {
      if (!name.startsWith("xmlns:")) continue;
      const prefix = name.slice(6);
      if (uri !== MAIN && !inherited.has(prefix)) continue;
      local ??= new Set(inherited);
      if (uri === MAIN) local.add(prefix);
      else local.delete(prefix);
    }
    const bindings = local ?? inherited;
    const colon = node.qname.indexOf(":");
    const project = colon >= 0 && bindings.has(node.qname.slice(0, colon));
    const range = node.sourceRange!;
    if (project) omit(range.start + 1, colon + 1);
    for (const child of node.children)
      if (child.kind === "element") visit(child, bindings);
    if (project && range.endTagStart < range.end)
      omit(range.endTagStart + 2, colon + 1);
  }
  visit(parseXml(xml, true), new Set());
  return chunks.length ? chunks.join("") + xml.slice(cursor) : xml;
}

/** Private in-memory input for the reader. Hashes, edits and downloads
 * continue to use the original package. Ordinary files take the fast path. */
export async function xlsxReaderBytes(bytes: Buffer, signal?: AbortSignal) {
  const candidates = new Map<string, string>();
  validateXlsx(bytes, signal, (name, xml) => {
    if (name.startsWith("xl/") && PREFIXED_MAIN.test(xml))
      candidates.set(name, xml);
  });
  let zip: JSZip | undefined;
  for (const [name, xml] of candidates) {
    checkSignal(signal);
    const projected = excelJsTags(xml);
    if (projected === xml) continue;
    zip ??= await JSZip.loadAsync(bytes);
    zip.file(name, projected, { createFolders: false });
  }
  if (!zip) return bytes;
  const adapted = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  validateXlsx(adapted, signal);
  return adapted;
}
