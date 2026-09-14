/**
 * Document facts read without converting anything (§11).
 *
 * `document_inspect` must be cheap and safe: it reads the bytes it was given
 * and answers what they claim to be. Two tiny readers cover the formats the
 * pipeline supports — a PDF dictionary scan and an OOXML package scan — which
 * is what makes inspect useful on a 400-page file that nobody wants to render.
 */

import type { DetectedFormat } from "../types.js";
import {
  findZipEntry,
  readZipEntries,
  readZipEntry,
  type ZipEntry,
} from "./zip.js";

export interface PdfFacts {
  readonly pages?: number;
  readonly encrypted: boolean;
  readonly metadata: {
    readonly title?: string;
    readonly author?: string;
    readonly createdAt?: string;
    readonly modifiedAt?: string;
  };
  readonly images?: number;
}

const PDF_DATE = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/u;

function normalizePdfDate(raw: string): string | undefined {
  const match = PDF_DATE.exec(raw.trim());
  if (match === null) return undefined;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

function decodePdfString(raw: string): string {
  const literal = /^\((.*)\)$/su.exec(raw.trim());
  const value = literal?.[1] ?? raw;
  return value
    .replace(/\\([nrtbf()\\])/gu, (_all, escape: string) => {
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
      };
      return map[escape] ?? escape;
    })
    .replace(/\\(\d{1,3})/gu, (_all, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    )
    .trim();
}

/**
 * Read a PDF's page count, encryption flag and document-information entries.
 * This is a scan, not a parser: it is immune to malformed cross-reference
 * tables (a broken PDF still answers "how many pages does it claim"), and it
 * never follows an object stream.
 */
export function readPdfFacts(buffer: Buffer): PdfFacts {
  const text = buffer.toString("latin1");
  const tail = text.slice(Math.max(0, text.length - 131_072));
  const encrypted =
    /\/Encrypt\b/u.test(tail) || /\/Encrypt\b/u.test(text.slice(0, 4_096));

  const pageMatches = text.match(/\/Type\s*\/Page[^s]/gu);
  const pages = pageMatches === null ? undefined : pageMatches.length;

  // The trailer names the document-information object; its dictionary is read
  // from the object itself, because the trailer's own dictionary holds no
  // title or author.
  const infoId = /\/Info\s+(\d+)\s+\d+\s+R/u.exec(tail)?.[1];
  const info =
    infoId === undefined
      ? undefined
      : new RegExp(`\\b${infoId}\\s+\\d+\\s+obj\\s*<<([\\s\\S]*?)>>`, "u").exec(
          text,
        )?.[1];
  const readEntry = (key: string): string | undefined => {
    if (info === undefined) return undefined;
    const pattern = new RegExp(
      `/${key}\\s*(\\((?:[^()\\\\]|\\\\.)*\\)|<[0-9A-Fa-f\\s]+>)`,
      "u",
    );
    const match = pattern.exec(info);
    if (match?.[1] === undefined) return undefined;
    const raw = match[1];
    if (raw.startsWith("<")) {
      const hex = raw.slice(1, -1).replace(/\s+/gu, "");
      const bytes = Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, "hex");
      /* eslint-disable-next-line no-control-regex -- NUL padding is exactly what this strips */
      const decoded = bytes.toString("utf16le").replace(/\u0000+$/u, "");
      return decoded.trim() === "" ? undefined : decoded.trim();
    }
    const decoded = decodePdfString(raw);
    return decoded === "" ? undefined : decoded;
  };

  const created = readEntry("CreationDate");
  const modified = readEntry("ModDate");
  const title = readEntry("Title");
  const author = readEntry("Author");
  const streamImages = (/\/Subtype\s*\/Image\b/gu.exec(text) ?? []).length;
  return {
    ...(pages === undefined || pages === 0 ? {} : { pages }),
    encrypted,
    metadata: {
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      ...(created === undefined
        ? {}
        : { createdAt: normalizePdfDate(created) ?? created }),
      ...(modified === undefined
        ? {}
        : { modifiedAt: normalizePdfDate(modified) ?? modified }),
    },
    ...(streamImages > 0 ? { images: streamImages } : {}),
  };
}

export interface DocxFacts {
  readonly headings?: number;
  readonly tables?: number;
  readonly images?: number;
}

const DOCX_FACTS_MAX_PART_BYTES = 32 * 1024 * 1024;

function readPart(
  buffer: Buffer,
  entries: readonly ZipEntry[],
  name: string,
): string | undefined {
  const entry = findZipEntry(entries, name);
  if (
    entry === undefined ||
    entry.uncompressedSize > DOCX_FACTS_MAX_PART_BYTES
  ) {
    return undefined;
  }
  const payload = readZipEntry(buffer, entry);
  return payload?.toString("utf8");
}

/** Count document structure from the OOXML package, without rendering it. */
export function readDocxFacts(buffer: Buffer): DocxFacts {
  const entries = readZipEntries(buffer);
  if (entries === undefined) return {};
  const document = readPart(buffer, entries, "word/document.xml");
  if (document === undefined) return {};
  const headingStyles =
    document.match(
      /<w:pStyle[^>]*w:val="(?:Heading|heading|Заголовок)[^"]*"/gu,
    ) ?? [];
  const outlineLevels = document.match(/<w:outlineLvl\b/gu) ?? [];
  const tables = (document.match(/<w:tbl>/gu) ?? []).length;
  const images =
    (document.match(/<w:drawing>/gu) ?? []).length +
    (document.match(/<w:pict>/gu) ?? []).length;
  const mediaParts = entries.filter((entry) =>
    /^word\/media\//iu.test(entry.name),
  ).length;
  return {
    headings: headingStyles.length + outlineLevels.length,
    tables,
    images: Math.max(images, mediaParts),
  };
}

/** Metadata recorded in `docProps/core.xml`. */
export function readDocxMetadata(buffer: Buffer): {
  readonly title?: string;
  readonly author?: string;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
} {
  const entries = readZipEntries(buffer);
  if (entries === undefined) return {};
  const core = readPart(buffer, entries, "docProps/core.xml");
  if (core === undefined) return {};
  const read = (tag: string): string | undefined => {
    const match = new RegExp(
      `<(?:[A-Za-z]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[A-Za-z]+:)?${tag}>`,
      "u",
    ).exec(core);
    const value = match?.[1]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const title = read("title");
  const author = read("creator");
  const created = read("created");
  const modified = read("modified");
  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(created === undefined ? {} : { createdAt: created }),
    ...(modified === undefined ? {} : { modifiedAt: modified }),
  };
}

export function mediaTypeOfDetected(format: DetectedFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "docm":
      return "application/vnd.ms-word.document.macroEnabled.12";
    case "markdown":
      return "text/markdown";
    default:
      return "application/octet-stream";
  }
}
