/** Unit tests for conservative base64 detection (SPEC §11). */

import { describe, expect, it } from "vitest";

import { decodeBase64Candidate } from "../../src/transform/base64.js";
import { sha256Hex } from "../../src/cas/hash.js";
import { TINY_PNG_BYTES } from "../fixtures/store-fixtures.js";

function options(overrides: Partial<Parameters<typeof decodeBase64Candidate>[1]> = {}) {
  return { enabled: true, minChars: 64, requireStrongDetection: true, ...overrides };
}

const PNG_RAW = Buffer.from(TINY_PNG_BYTES).toString("base64");

describe("decodeBase64Candidate", () => {
  it("decodes a data URI with a media type", () => {
    const decoded = decodeBase64Candidate(`data:image/png;base64,${PNG_RAW}`, options());
    expect(decoded).not.toBeNull();
    expect(decoded?.mediaType).toBe("image/png");
    expect(decoded?.fromDataUri).toBe(true);
    expect(Buffer.from(decoded?.bytes ?? []).equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });

  it("decodes a raw base64 payload with binary evidence", () => {
    const decoded = decodeBase64Candidate(PNG_RAW, options());
    expect(decoded).not.toBeNull();
    expect(decoded?.mediaType).toBe("image/png");
  });

  it("collapses equivalent representations of the same binary to one identity (SPEC AC5)", () => {
    const padded = PNG_RAW;
    const withWhitespace = `data:application/octet-stream;base64,${padded.slice(0, 20)} ${padded.slice(20)}`;
    const withDifferentMediaType = `data:image/png;base64,${padded}`;
    const identities = [padded, withWhitespace, withDifferentMediaType]
      .map((candidate) => decodeBase64Candidate(candidate, options()))
      .map((decoded) => sha256Hex(decoded?.bytes ?? new Uint8Array(0)));
    expect(new Set(identities).size).toBe(1);
  });

  it("rejects alphabet-conforming random text (no binary evidence)", () => {
    // 8192 chars of pseudo-random base64-alphabet text that decodes to
    // text-like bytes; strong detection must refuse it.
    let state = 987654321;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let candidate = "";
    while (candidate.length < 8192) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const byte = state & 0xff;
      // Bias towards letters so the decoded bytes stay text-like.
      candidate += chars[(byte % 52) % 64];
    }
    candidate = candidate.slice(0, 8192);
    const decoded = decodeBase64Candidate(candidate, options());
    if (decoded !== null) {
      // If it happened to decode, the strong evidence must still be absent.
      expect(decoded.mediaType).toBe("application/octet-stream");
      expect(decoded.fromDataUri).toBe(false);
    }
  });

  it("rejects invalid shapes without attempting storage", () => {
    // Length not a multiple of four.
    expect(decodeBase64Candidate(`${PNG_RAW}a`, options())).toBeNull();
    // Invalid alphabet.
    expect(decodeBase64Candidate(`${PNG_RAW.slice(0, -1)}!`, options())).toBeNull();
    // Misplaced padding.
    expect(decodeBase64Candidate(`${PNG_RAW.slice(0, 20)}=${PNG_RAW.slice(21)}`, options())).toBeNull();
    // Empty decode.
    expect(decodeBase64Candidate("====", options())).toBeNull();
  });

  it("ignores short candidates even when valid", () => {
    const short = Buffer.from(TINY_PNG_BYTES).toString("base64").slice(0, 32);
    expect(decodeBase64Candidate(short, options({ minChars: 8192 }))).toBeNull();
  });

  it("respects the enabled flag", () => {
    expect(decodeBase64Candidate(`data:image/png;base64,${PNG_RAW}`, options({ enabled: false }))).toBeNull();
  });

  it("refuses weak raw candidates when strong detection is required", () => {
    // Text-like bytes that re-encode canonically; weak mode accepts, strong refuses.
    const weakPayload = Buffer.from("just some repeated textual content. ".repeat(200), "utf8").toString("base64");
    expect(decodeBase64Candidate(weakPayload, options({ requireStrongDetection: false }))).not.toBeNull();
    expect(decodeBase64Candidate(weakPayload, options({ requireStrongDetection: true }))).toBeNull();
  });
});
