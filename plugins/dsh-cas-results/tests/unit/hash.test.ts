/** Unit tests for content identity helpers (SPEC §10, §25). */

import { describe, expect, it } from "vitest";

import { CasError } from "../../src/cas/errors.js";
import { formatCasRef, parseCasRef, sha256Hex, CAS_REF_PATTERN } from "../../src/cas/hash.js";

const VALID_HASH = "ac78199a1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b";

describe("sha256Hex", () => {
  it("produces the known digest of the empty payload", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic and length-64 hex", () => {
    const digest = sha256Hex(new TextEncoder().encode("payload"));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex(new TextEncoder().encode("payload"))).toBe(digest);
  });

  it("distinguishes payloads by exact bytes (no normalization)", () => {
    const lf = sha256Hex(new TextEncoder().encode("a\nb"));
    const crlf = sha256Hex(new TextEncoder().encode("a\r\nb"));
    expect(lf).not.toBe(crlf);
  });
});

describe("parseCasRef", () => {
  it("accepts a well-formed sha256 reference and returns the bare hash", () => {
    expect(parseCasRef(`sha256:${VALID_HASH}`)).toBe(VALID_HASH);
  });

  it("accepts surrounding whitespace", () => {
    expect(parseCasRef(`  sha256:${VALID_HASH}  `)).toBe(VALID_HASH);
  });

  it("rejects malformed references", () => {
    for (const bad of [
      "",
      "sha256:",
      `sha256:${VALID_HASH.slice(0, 63)}`,
      `sha256:${VALID_HASH.toUpperCase()}`,
      `SHA256:${VALID_HASH}`,
      `md5:${VALID_HASH}`,
      `sha256:${VALID_HASH}extra`,
      "sha256:zz78199a1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b1c8f9b3b",
      "../../etc/passwd",
    ]) {
      expect(() => parseCasRef(bad)).toThrowError(CasError);
      expect(() => parseCasRef(bad)).toThrowError(/invalid CAS reference/);
    }
  });
});

describe("formatCasRef", () => {
  it("prefixes the bare hash", () => {
    expect(formatCasRef(VALID_HASH)).toBe(`sha256:${VALID_HASH}`);
  });
});

describe("CAS_REF_PATTERN", () => {
  it("requires exactly sha256 plus 64 lowercase hex characters", () => {
    expect(CAS_REF_PATTERN.test(`sha256:${VALID_HASH}`)).toBe(true);
    expect(CAS_REF_PATTERN.test(`sha256:${VALID_HASH}0`)).toBe(false);
  });
});
