/**
 * Conservative base64 detection (SPEC §11).
 *
 * A long alphabet-conforming string is not decoded merely because it could
 * be base64. Candidates must pass, in order:
 *
 * 1. shape: data-URI prefix or pure base64 alphabet with sane length/padding;
 * 2. strict decode;
 * 3. canonical re-encode equivalence (modulo padding and whitespace);
 * 4. strong evidence when `requireStrongDetection` is on: a data-URI media
 *    type, a known binary magic header, or a binary-like byte profile.
 */

import { Buffer } from "node:buffer";

import { sniffBinaryMediaType } from "./classify.js";

const DATA_URI_PATTERN = /^\s*data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?;base64,([A-Za-z0-9+/=\s]+)\s*$/;
const RAW_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface Base64DetectionOptions {
  enabled: boolean;
  /** Minimum candidate length in characters before detection even runs. */
  minChars: number;
  /** Require data-URI context or binary evidence for raw candidates. */
  requireStrongDetection: boolean;
}

export interface DecodedBase64 {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly fromDataUri: boolean;
}

export function isBinaryLike(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) > 0.1;
}

/**
 * Detect and decode a confident base64 payload. Returns `null` when the
 * string is not confidently base64; the caller then treats it as text.
 */
export function decodeBase64Candidate(value: string, options: Base64DetectionOptions): DecodedBase64 | null {
  if (!options.enabled || value.length < options.minChars) return null;

  const dataUri = DATA_URI_PATTERN.exec(value);
  if (dataUri !== null) {
    const normalized = dataUri[2]?.replace(/\s+/g, "") ?? "";
    if (!isPlausibleBase64Shape(normalized)) return null;
    const bytes = strictDecode(normalized);
    if (bytes === null) return null;
    return {
      bytes,
      mediaType: dataUri[1] ?? sniffBinaryMediaType(bytes),
      fromDataUri: true,
    };
  }

  const trimmed = value.trim();
  if (!RAW_BASE64_PATTERN.test(trimmed) || !isPlausibleBase64Shape(trimmed)) return null;
  const bytes = strictDecode(trimmed);
  if (bytes === null) return null;

  const mediaType = sniffBinaryMediaType(bytes);
  const strongEvidence =
    dataUri !== null ||
    mediaType !== "application/octet-stream" ||
    isBinaryLike(bytes);
  if (options.requireStrongDetection && !strongEvidence) return null;
  return { bytes, mediaType, fromDataUri: false };
}

function isPlausibleBase64Shape(value: string): boolean {
  // The candidate regex already confines padding to a 1-2 character suffix;
  // base64 requires the total length to be a multiple of four.
  return value.length >= 8 && value.length % 4 === 0;
}

function strictDecode(value: string): Uint8Array | null {
  try {
    const buffer = Buffer.from(value, "base64");
    // `Buffer.from` is lenient; require the canonical re-encoding (modulo
    // padding) to equal the candidate before trusting the decode.
    if (buffer.length === 0) return null;
    if (reEncode(buffer) !== stripPadding(value)) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function reEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "");
}

function stripPadding(value: string): string {
  return value.replace(/=+$/, "");
}
