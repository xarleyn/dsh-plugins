/**
 * File-type identification and asset MIME policy (§26.3, §26.6, §17.1).
 *
 * The extension is a hint, never the authority: PDF is recognized by its
 * header (after a bounded scan, because a PDF may carry leading junk), OOXML
 * by its ZIP container plus the parts it holds, and macro-enabled documents by
 * the presence of a VBA project. Legacy OLE documents (`.doc`, `.xls`, `.ppt`)
 * are recognized only to be refused with a precise message.
 */

import path from "node:path";

import type { DetectedFormat, DocumentFormat } from "../types.js";
import { findZipEntry, readZipEntries, readZipEntry } from "../inspect/zip.js";
import { sanitizeBackendOutput } from "../errors.js";

const PDF_HEADER = Buffer.from("%PDF-", "latin1");
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_HEADER = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CFB_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
/** A PDF header may be preceded by junk; the spec fixes no bound, we use 4 KiB. */
const PDF_HEADER_SCAN_BYTES = 4 * 1024;
/** Bounded text sniffing window for Markdown/plain-text inputs. */
const TEXT_SNIFF_BYTES = 4 * 1024;

export const DOCUMENT_MEDIA_TYPES: Readonly<Record<DocumentFormat, string>> = {
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

export function mediaTypeFor(format: DocumentFormat): string {
  return DOCUMENT_MEDIA_TYPES[format];
}

export function extensionFor(format: DocumentFormat): string {
  return format === "md" ? "md" : format;
}

export interface SniffedDocument {
  readonly format: DetectedFormat;
  readonly mediaType: string;
  /** The file is a ZIP container holding a Word processing document. */
  readonly wordprocessing?: boolean;
  /** `word/vbaProject.bin` or a macro-enabled content type is present. */
  readonly macroEnabled?: boolean;
  /** Container recognized as OOXML but not a supported document flavour. */
  readonly unsupportedOffice?: boolean;
}

const DOCX_PART = /^word\/(?:document|styles|settings)\.xml$/iu;
const MACRO_PART = /^word\/vbaProject\.bin$/iu;
const CONTENT_TYPES_PART = "[Content_Types].xml";
const MACRO_CONTENT_TYPE = /macroEnabled/iu;

function sniffZip(buffer: Buffer): SniffedDocument {
  const entries = readZipEntries(buffer);
  if (entries === undefined) {
    return { format: "unknown", mediaType: "application/octet-stream" };
  }
  const word = entries.some((entry) => DOCX_PART.test(entry.name));
  const macroPart = entries.some((entry) => MACRO_PART.test(entry.name));
  const contentTypes = findZipEntry(entries, CONTENT_TYPES_PART);
  let macroContentType = false;
  if (contentTypes !== undefined && !macroPart) {
    const payload = readZipEntry(buffer, contentTypes);
    if (payload !== undefined) {
      macroContentType = MACRO_CONTENT_TYPE.test(
        payload.toString("utf8", 0, Math.min(payload.length, 8 * 1024)),
      );
    }
  }
  if (!word && !macroPart && !macroContentType) {
    return {
      format: "unknown",
      mediaType: "application/zip",
      unsupportedOffice: true,
    };
  }
  const macroEnabled = macroPart || macroContentType;
  return {
    format: macroEnabled ? "docm" : "docx",
    mediaType: macroEnabled
      ? "application/vnd.ms-word.document.macroEnabled.12"
      : DOCUMENT_MEDIA_TYPES.docx,
    wordprocessing: true,
    macroEnabled,
  };
}

/** Detect binary content without trusting the extension. */
function looksLikeText(buffer: Buffer): boolean {
  const window = buffer.subarray(0, TEXT_SNIFF_BYTES);
  for (const byte of window) {
    if (byte === 0) return false;
  }
  return true;
}

const MARKDOWN_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".txt",
]);

export function detectFormatByExtension(
  filename: string,
): DocumentFormat | undefined {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx" || extension === ".docm") return "docx";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "md";
  return undefined;
}

/**
 * Identify a document from its bytes, falling back to the extension only where
 * bytes are inconclusive (plain text and Markdown are both just text).
 */
export function sniffDocument(
  buffer: Buffer,
  filename?: string,
): SniffedDocument {
  const head = buffer.subarray(
    0,
    Math.max(PDF_HEADER_SCAN_BYTES, ZIP_LOCAL_HEADER.length),
  );
  if (head.includes(PDF_HEADER)) {
    return { format: "pdf", mediaType: DOCUMENT_MEDIA_TYPES.pdf };
  }
  if (
    head.subarray(0, ZIP_LOCAL_HEADER.length).equals(ZIP_LOCAL_HEADER) ||
    head.subarray(0, ZIP_EMPTY_HEADER.length).equals(ZIP_EMPTY_HEADER)
  ) {
    return sniffZip(buffer);
  }
  if (head.subarray(0, CFB_HEADER.length).equals(CFB_HEADER)) {
    return { format: "unknown", mediaType: "application/x-ole-storage" };
  }
  const byExtension =
    filename === undefined ? undefined : detectFormatByExtension(filename);
  if (byExtension === "md" && looksLikeText(buffer)) {
    return { format: "markdown", mediaType: DOCUMENT_MEDIA_TYPES.md };
  }
  if (byExtension === "pdf" || byExtension === "docx") {
    // The bytes contradict the name; the bytes win.
    return { format: "unknown", mediaType: "application/octet-stream" };
  }
  if (looksLikeText(buffer)) {
    return { format: "markdown", mediaType: DOCUMENT_MEDIA_TYPES.md };
  }
  return { format: "unknown", mediaType: "application/octet-stream" };
}

/** The supported source format behind a sniff result, or `undefined`. */
export function supportedFormatOf(
  sniffed: SniffedDocument,
): DocumentFormat | undefined {
  if (sniffed.format === "pdf") return "pdf";
  if (sniffed.format === "docx") return "docx";
  if (sniffed.format === "markdown") return "md";
  return undefined;
}

/** Human-facing explanation of a sniff result the pipeline refuses. */
export function describeUnsupported(
  sniffed: SniffedDocument,
  filename: string,
): string {
  if (sniffed.format === "docm") {
    return `"${path.basename(filename)}" is a macro-enabled document; macro-enabled documents are not processed`;
  }
  if (sniffed.unsupportedOffice) {
    return `"${path.basename(filename)}" is an OOXML package this pipeline does not support (supported: DOCX, PDF, Markdown)`;
  }
  if (sniffed.mediaType === "application/x-ole-storage") {
    return `"${path.basename(filename)}" is a legacy OLE Office document (supported: DOCX, PDF, Markdown)`;
  }
  return `"${path.basename(filename)}" is not a supported document (supported: DOCX, PDF, Markdown)`;
}

export {
  DEFAULT_ASSET_MIME_TYPES,
  isAllowedAssetMimeType,
  mimeTypeForFilename,
} from "./mime.js";

/** Magic-byte MIME detection for the asset types the pipeline accepts. */
export function mimeTypeOfBytes(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 6 &&
    buffer.toString("latin1", 0, 6).startsWith("GIF8")
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer.toString("latin1", 0, 2) === "BM") {
    return "image/bmp";
  }
  if (buffer.length >= 4) {
    const little = buffer.toString("latin1", 0, 4);
    if (little === "II*\u0000" || little === "MM\u0000*") return "image/tiff";
  }
  return undefined;
}

/** A short, sanitized description of the first bytes, for error messages. */
export function describeBytes(buffer: Buffer): string {
  return sanitizeBackendOutput(
    [...buffer.subarray(0, 16)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" "),
    120,
  );
}
