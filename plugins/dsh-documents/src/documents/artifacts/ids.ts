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

const ARTIFACT_ID_PATTERN = /^doc_[0-9A-HJKMNP-TV-Z]{26}$/u;

/** Whether a string is an artifact id this pipeline could have issued. */
export function isArtifactId(value: string): boolean {
  return ARTIFACT_ID_PATTERN.test(value);
}
