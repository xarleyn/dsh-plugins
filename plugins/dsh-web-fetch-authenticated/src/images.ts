/**
 * Raster-image vocabulary of the download seam (SPEC §15.4). The harness body
 * union carries text only, so an image cannot travel as a fetch result; the
 * download tool commits the bytes to durable attachment storage instead, and
 * the image block it returns is what the model actually sees.
 *
 * The accepted set is deliberately the attachment store's own raster set: a
 * format the store would refuse must be refused here, before any bytes are
 * saved.
 * @module images
 */

/** Raster formats the attachment store accepts in version one. */
export type ImageMediaType =
  "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** Formats this tool stores, in the order the accept header lists them. */
export const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** The `Accept` an image download advertises. */
export function imageAcceptHeader(): string {
  return IMAGE_MEDIA_TYPES.join(",");
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function startsWith(
  data: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  if (data.byteLength < offset + expected.length) return false;
  return expected.every((byte, index) => data[offset + index] === byte);
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Identify the media type from the file signature itself. A server's
 * `Content-Type` is a hint a deployment may have mangled (a Jira attachment
 * is routinely served as `application/octet-stream`), so the bytes decide what
 * this tool claims, and the attachment store's full decode stays authoritative.
 */
export function sniffImageMediaType(
  data: Uint8Array,
): ImageMediaType | undefined {
  if (startsWith(data, 0, PNG_SIGNATURE)) return "image/png";
  if (startsWith(data, 0, JPEG_SIGNATURE)) return "image/jpeg";
  if (asciiAt(data, 0, "GIF87a") || asciiAt(data, 0, "GIF89a"))
    return "image/gif";
  if (asciiAt(data, 0, "RIFF") && asciiAt(data, 8, "WEBP")) return "image/webp";
  return undefined;
}

/** A filename for the stored attachment, derived from the URL path. */
export function imageNameFromUrl(url: string): string {
  return downloadNameFromUrl(url, "image");
}

/** A sanitized display filename for an arbitrary downloaded response. */
export function fileNameFromUrl(url: string): string {
  return downloadNameFromUrl(url, "download");
}

function downloadNameFromUrl(url: string, fallback: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return fallback;
  }
  const leaf = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);
  if (leaf === undefined) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(leaf);
  } catch {
    decoded = leaf;
  }
  // Attachment URLs carry percent-encoded braces and spaces; the store keeps
  // the name as a leaf, so anything path-like is flattened here.
  const cleaned = decoded.replace(/[\\/:*?"<>|]/gu, "-").trim();
  return cleaned.length === 0 ? fallback : cleaned;
}
