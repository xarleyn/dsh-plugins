/**
 * The document-extraction seam of the transport: decide whether a response is
 * an office document whose TEXT the model should receive instead of a refusal,
 * and turn those bytes into Markdown.
 *
 * The `WebFetchBody` union of the harness is `html | text` and is owned by
 * `@deepseek-ai/dsh-web`, so a provider can never hand a binary body to the
 * model. Extraction is therefore the only way an attachment becomes readable:
 * the bytes stay inside the plugin, and what leaves is text. Formats outside the
 * supported set are refused with a reason the model can act on ("a PDF is not
 * text-extractable here") instead of a bare content-type rejection.
 * @module documents/extract
 */

import {
  DOCX_MACRO_MEDIA_TYPE,
  DOCX_MEDIA_TYPE,
  DOCX_TEMPLATE_MEDIA_TYPE,
  ODT_MEDIA_TYPE,
  extractOfficeText,
  type ExtractedDocumentText,
  type OfficeFormat,
} from "./ooxml.js";

/** Size and length caps for one extraction; all three are configured per rule. */
export interface DocumentExtractionSettings {
  /** Whether this rule may extract document text at all. */
  readonly enabled: boolean;
  /** Largest document downloaded for extraction. */
  readonly maxBytes: number;
  /** Largest extracted text handed to the model. */
  readonly maxChars: number;
}

/** Extension → format, for URLs that arrive without a trustworthy media type. */
const EXTENSION_FORMATS: Readonly<Record<string, OfficeFormat>> = Object.freeze(
  {
    docx: "docx",
    docm: "docx",
    dotx: "docx",
    dotm: "docx",
    odt: "odt",
  },
);

/** Document extensions this plugin deliberately does not extract. */
const REFUSED_EXTENSIONS: ReadonlySet<string> = new Set([
  "doc",
  "dot",
  "pdf",
  "rtf",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "odg",
  "csv",
  "zip",
  "7z",
  "rar",
  "tar",
  "gz",
]);

const EXTRACTABLE_MEDIA_TYPES: Readonly<Record<string, OfficeFormat>> =
  Object.freeze({
    [DOCX_MEDIA_TYPE]: "docx",
    [DOCX_MACRO_MEDIA_TYPE]: "docx",
    [DOCX_TEMPLATE_MEDIA_TYPE]: "docx",
    [ODT_MEDIA_TYPE]: "odt",
  });

/** Media types that carry no hint about the payload (Confluence downloads). */
const OPAQUE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "application/download",
  "application/force-download",
]);

/** Media types of documents that are real documents but not text-extractable here. */
const REFUSED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/msword",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

/** What the request URL + response media type say about a response body. */
export type DocumentTarget =
  | {
      readonly extractable: true;
      readonly format: OfficeFormat;
      readonly filename: string;
    }
  | {
      readonly extractable: false;
      readonly filename: string;
      readonly reason: string;
    };

/** Reason text shared by every refusal, so the message stays one sentence. */
const NOT_EXTRACTABLE =
  "only Word (.docx) and OpenDocument (.odt) attachments are read as text by this plugin";

/**
 * Classify a response for extraction. `undefined` means "not a document at all"
 * — the caller then keeps the ordinary unsupported-content-type behavior.
 */
export function classifyDocumentTarget(
  url: string,
  contentType: string | null,
): DocumentTarget | undefined {
  const filename = filenameOf(url);
  const mediaType = normalizeMediaType(contentType);
  const known = EXTRACTABLE_MEDIA_TYPES[mediaType];
  if (known !== undefined)
    return { extractable: true, format: known, filename };

  const extension = extensionOf(filename);
  if (extension !== undefined) {
    const format = EXTENSION_FORMATS[extension];
    if (
      format !== undefined &&
      (OPAQUE_MEDIA_TYPES.has(mediaType) || mediaType === "")
    )
      return { extractable: true, format, filename };
    if (REFUSED_EXTENSIONS.has(extension))
      return {
        extractable: false,
        filename,
        reason: `the .${extension} format is not extracted — ${NOT_EXTRACTABLE}`,
      };
  }
  if (REFUSED_MEDIA_TYPES.has(mediaType))
    return {
      extractable: false,
      filename,
      reason: `${mediaType} is not extracted — ${NOT_EXTRACTABLE}`,
    };
  return undefined;
}

export interface ExtractDocumentInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  /** Format hint from {@link classifyDocumentTarget}; the archive still decides. */
  readonly format?: OfficeFormat;
  /** Cap on the inflated XML part. */
  readonly maxPartBytes: number;
  /** Cap on the produced Markdown. */
  readonly maxChars: number;
}

export interface ExtractedDocument extends ExtractedDocumentText {
  /** Text handed to the model: provenance line, body, truncation note. */
  readonly content: string;
  readonly filename: string;
  readonly bytes: number;
}

/**
 * Extract a document. `undefined` means the bytes are not an office document
 * this module understands, whatever the URL or media type claimed.
 */
export function extractDocument(
  input: ExtractDocumentInput,
): ExtractedDocument | undefined {
  const extracted = extractOfficeText(
    input.bytes,
    { maxPartBytes: input.maxPartBytes, maxChars: input.maxChars },
    input.format,
  );
  if (extracted === undefined) return undefined;
  return {
    ...extracted,
    filename: input.filename,
    bytes: input.bytes.byteLength,
    content: renderExtracted(extracted, input, input.bytes.byteLength),
  };
}

/** The one-line provenance note that precedes extracted text. */
function renderExtracted(
  extracted: ExtractedDocumentText,
  input: ExtractDocumentInput,
  bytes: number,
): string {
  const header = `_[attachment text extracted: ${input.filename} (${extracted.format.toUpperCase()}, ${formatBytes(bytes)})]_`;
  const body = extracted.markdown.trim();
  const truncated = extracted.truncated
    ? `\n\n_[text truncated at ${input.maxChars} characters — the rest of the document is not shown]_`
    : "";
  return `${header}\n\n${body}${truncated}`;
}

/** Media type without parameters, lowercased. */
export function normalizeMediaType(contentType: string | null): string {
  return (contentType ?? "").replace(/;.*$/su, "").trim().toLowerCase();
}

/** Last path segment of the URL, percent-decoded; empty for a bare path. */
export function filenameOf(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname
      .split("/")
      .filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1] ?? "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return "";
  }
}

function extensionOf(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return undefined;
  return filename.slice(dot + 1).toLowerCase();
}

/** Human byte size for the provenance line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
