/**
 * ULID generation for artifact ids (§18).
 *
 * `doc_<ULID>` — 48 bits of time followed by 80 bits of randomness, encoded in
 * Crockford base32. The time prefix keeps a directory listing chronological,
 * and the randomness keeps ids unguessable without a UUID dependency.
 */

import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const TIME_MAX = 0xffffffffffff;

function encodeTime(timestamp: number): string {
  let remaining = Math.max(0, Math.min(TIME_MAX, Math.floor(timestamp)));
  const output: string[] = new Array<string>(TIME_CHARS);
  for (let index = TIME_CHARS - 1; index >= 0; index -= 1) {
    output[index] = ENCODING[remaining % 32] ?? "0";
    remaining = Math.floor(remaining / 32);
  }
  return output.join("");
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_CHARS);
  let output = "";
  for (const byte of bytes) {
    output += ENCODING[byte % 32] ?? "0";
  }
  return output;
}

/** A fresh ULID for the current millisecond. */
export function createUlid(now: number = Date.now()): string {
  return `${encodeTime(now)}${encodeRandom()}`;
}

/** A fresh artifact id: `doc_<ULID>`. */
export function createArtifactId(now: number = Date.now()): string {
  return `doc_${createUlid(now)}`;
}

/**
 * A fresh comparison id: `cmp_<ULID>`. A comparison is an artifact like any
 * other — same store, same root, same retention — and only its prefix says that
 * its subject is a pair of documents rather than one.
 */
export function createComparisonId(now: number = Date.now()): string {
  return `cmp_${createUlid(now)}`;
}

const DOCUMENT_ID_PATTERN = /^doc_[0-9A-HJKMNP-TV-Z]{26}$/u;
const COMPARISON_ID_PATTERN = /^cmp_[0-9A-HJKMNP-TV-Z]{26}$/u;

/** Whether a string is a document artifact id this pipeline could have issued. */
export function isDocumentArtifactId(value: string): boolean {
  return DOCUMENT_ID_PATTERN.test(value);
}

/** Whether a string is a comparison id this pipeline could have issued. */
export function isComparisonId(value: string): boolean {
  return COMPARISON_ID_PATTERN.test(value);
}

/** Whether a string is any artifact id this pipeline could have issued. */
export function isArtifactId(value: string): boolean {
  return isDocumentArtifactId(value) || isComparisonId(value);
}
