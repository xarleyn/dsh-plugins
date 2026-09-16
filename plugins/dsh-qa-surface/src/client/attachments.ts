/**
 * Composer-side attachment intake: which files are accepted, how a pasted
 * blob turns into an attachment, and the browser-side ceilings. The Host
 * remains authoritative — these checks exist so a refusal happens before a
 * round trip, not to replace the Host's own admission.
 */

import { countTextLines, hasTextExtension } from "../attachment-rules.js";
import type {
  QaAttachmentDraft,
  QaFileDraft,
  QaImageDraft,
  QaImageMediaType,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { bytesToBase64 } from "./base64.js";
import { pluralRu } from "./settings/format.js";

/** Raster formats the host attachment path accepts. */
export const QA_IMAGE_MEDIA_TYPES: readonly QaImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** Soft image ceiling; the Host stays authoritative at admission. */
export const QA_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** The attachment policy as the composer reads it. */
export interface QaAttachmentLimits {
  readonly textFiles: boolean;
  readonly pastedTextLines: number;
  readonly maxFileBytes: number;
  readonly maxPending: number;
  readonly extensions: readonly string[];
}

/**
 * Project the deployment's resolved configuration into the composer's policy.
 * @param config - effective QA configuration.
 * @returns the attachment ceilings the composer enforces.
 */
export function attachmentLimits(
  config: ResolvedQaSurfaceConfig,
): QaAttachmentLimits {
  return {
    textFiles: config.attachments.textFiles,
    pastedTextLines: config.attachments.pastedTextLines,
    maxFileBytes: config.attachments.maxFileBytes,
    maxPending: config.attachments.maxPending,
    extensions: config.attachments.extensions,
  };
}

/**
 * The file picker's `accept` value: the raster formats plus either the
 * configured text extensions or the browser's whole `text/*` family.
 * @param limits - attachment policy in effect.
 * @returns the accept attribute value.
 */
export function attachmentAccept(limits: QaAttachmentLimits): string {
  const parts: string[] = [...QA_IMAGE_MEDIA_TYPES];
  if (limits.textFiles) {
    parts.push("text/*", ...limits.extensions.map((value) => `.${value}`));
  }
  return parts.join(",");
}

let attachmentSequence = 0;

function nextDraftId(kind: "image" | "file"): string {
  attachmentSequence += 1;
  return `${kind}-${String(attachmentSequence)}`;
}

/** FileReader covers runtimes without File.arrayBuffer (jsdom). */
function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

/** Whether one browser-reported MIME type is worth offering as text. */
function isTextMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("text/");
}

/** Whether a dropped payload may be attached as a text file at all. */
export function acceptsTextFile(
  name: string,
  mediaType: string,
  limits: QaAttachmentLimits,
): boolean {
  if (!limits.textFiles) return false;
  return (
    hasTextExtension(name, limits.extensions) || isTextMediaType(mediaType)
  );
}

function imageDraftFromBlob(blob: Blob, name: string): Promise<QaImageDraft> {
  return readAsArrayBuffer(blob).then((buffer) => ({
    kind: "image" as const,
    id: nextDraftId("image"),
    mediaType: blob.type as QaImageMediaType,
    name: name === "" ? "изображение" : name,
    data: bytesToBase64(new Uint8Array(buffer)),
    previewUrl: URL.createObjectURL(blob),
  }));
}

/**
 * Turn one dropped or picked file into a composer draft, or into the message
 * the visitor sees when the file is not accepted.
 * @param file - browser file from a picker, drop or paste.
 * @param limits - attachment policy in effect.
 * @returns the draft, or a refusal message.
 */
export async function draftFromFile(
  file: File,
  limits: QaAttachmentLimits,
): Promise<QaAttachmentDraft | string> {
  if (QA_IMAGE_MEDIA_TYPES.includes(file.type as QaImageMediaType)) {
    if (file.size > QA_MAX_IMAGE_BYTES) {
      return `Изображение слишком большое (лимит ${formatFileSize(QA_MAX_IMAGE_BYTES)}).`;
    }
    return imageDraftFromBlob(file, file.name);
  }
  if (!acceptsTextFile(file.name, file.type, limits)) {
    return limits.textFiles
      ? "Поддерживаются изображения и текстовые файлы (md, txt, log и другие)."
      : "Поддерживаются изображения PNG, JPEG, WebP и GIF.";
  }
  if (file.size > limits.maxFileBytes) {
    return `Файл слишком большой (лимит ${formatFileSize(limits.maxFileBytes)}).`;
  }
  return {
    kind: "file",
    id: nextDraftId("file"),
    name: file.name === "" ? "файл.txt" : file.name,
    bytes: file.size,
    blob: file,
  };
}

/**
 * Convert a large pasted blob into an attached file. Pasted text has no file
 * name of its own, so the name states what it is; the model resolves it from
 * the durable store like any other attachment.
 * @param text - pasted plain text.
 * @param limits - attachment policy in effect.
 * @returns the draft, or null when the paste stays in the input field.
 */
export function draftFromPaste(
  text: string,
  limits: QaAttachmentLimits,
): QaFileDraft | null {
  if (!limits.textFiles || limits.pastedTextLines <= 0) return null;
  const lines = countTextLines(text);
  if (lines <= limits.pastedTextLines) return null;
  const name = `Вставленный текст (${pluralRu(lines, ["строка", "строки", "строк"])}).txt`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  return {
    kind: "file",
    id: nextDraftId("file"),
    name,
    bytes: blob.size,
    blob,
  };
}

/** Human-readable megabyte budget for refusal messages. */
function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  const rounded =
    megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10;
  return `${String(rounded).replace(".", ",")} МБ`;
}

/** Format one attachment size for a card, a chip or a refusal message. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} Б`;
  if (bytes < 1024 * 1024)
    return `${String(Math.max(1, Math.round(bytes / 1024)))} КБ`;
  return formatMegabytes(bytes);
}
