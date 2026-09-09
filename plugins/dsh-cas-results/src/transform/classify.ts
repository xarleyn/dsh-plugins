/**
 * Content classification for plain strings (SPEC §12, §18).
 *
 * Classification drives both the candidate threshold and the preview style.
 * Detection is intentionally cheap and deterministic; anything that does not
 * clearly look like HTML or a log stream stays generic text.
 */

import type { CasKind } from "../cas/types.js";

const HTML_HEAD_PATTERN = /^\s*(?:<!doctype\s+html|<html[\s>])/i;

const LOG_LEVEL_PATTERN = /\b(?:DEBUG|TRACE|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR!|FATAL|CRITICAL)\b/;
const LOG_TIMESTAMP_PATTERN =
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s/;

export interface StringClass {
  readonly kind: Exclude<CasKind, "binary">;
  readonly mediaType: string;
}

export function classifyText(value: string): StringClass {
  if (HTML_HEAD_PATTERN.test(value)) {
    return { kind: "html", mediaType: "text/html" };
  }
  if (isLogLike(value)) {
    return { kind: "log", mediaType: "text/log" };
  }
  return { kind: "text", mediaType: "text/plain" };
}

function isLogLike(value: string): boolean {
  const sample = value.slice(0, 8192);
  const lines = sample.split(/\r\n|\r|\n/);
  const inspected = lines.slice(0, 50).filter((line) => line.trim().length > 0);
  if (inspected.length < 5) return false;
  let evidence = 0;
  for (const line of inspected) {
    if (LOG_TIMESTAMP_PATTERN.test(line) || LOG_LEVEL_PATTERN.test(line)) evidence += 1;
  }
  return evidence / inspected.length >= 0.5;
}

/** Media-type sniffing for decoded base64 payloads (SPEC §10, §11). */
export function sniffBinaryMediaType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4) {
    const head = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    if (head === "GIF8") return "image/gif";
    if (head === "%PDF") return "application/pdf";
    if (head === "PK\u0003\u0004") return "application/zip";
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "application/gzip";
  return "application/octet-stream";
}
