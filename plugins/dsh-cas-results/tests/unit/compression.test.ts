/** Unit tests for on-disk compression modes (SPEC §17). */

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { applyAutoCompression, decompressPayload, compressPayload, isPreCompressedMedia, resolveCodec } from "../../src/cas/compression.js";
import { CasError } from "../../src/cas/errors.js";
import { makeText } from "../fixtures/store-fixtures.js";

const encoder = new TextEncoder();

describe("resolveCodec", () => {
  it("honors explicit modes", () => {
    expect(resolveCodec("none", "text", "text/plain")).toBe("none");
    expect(resolveCodec("gzip", "text", "text/plain")).toBe("gzip");
  });

  it("auto compresses textual content", () => {
    expect(resolveCodec("auto", "log", "text/log")).toBe("gzip");
    expect(resolveCodec("auto", "text", "text/plain")).toBe("gzip");
  });

  it("auto leaves already-compressed binary media alone", () => {
    expect(resolveCodec("auto", "binary", "image/png")).toBe("none");
    expect(resolveCodec("auto", "binary", "application/zip")).toBe("none");
    expect(resolveCodec("auto", "binary", "application/octet-stream")).toBe("gzip");
  });
});

describe("isPreCompressedMedia", () => {
  it("detects compressed families", () => {
    expect(isPreCompressedMedia("image/jpeg")).toBe(true);
    expect(isPreCompressedMedia("video/mp4")).toBe(true);
    expect(isPreCompressedMedia("text/html")).toBe(false);
  });
});

describe("compress/decompress roundtrip", () => {
  it("preserves logical bytes", async () => {
    const payload = encoder.encode(makeText(200_000));
    const stored = await compressPayload(payload, "gzip");
    expect(stored.length).toBeLessThan(payload.length);
    const restored = await decompressPayload(stored, "gzip");
    expect(Buffer.from(restored).equals(Buffer.from(payload))).toBe(true);
  });

  it("returns the same bytes when codec is none", async () => {
    const payload = encoder.encode("tiny");
    expect(await compressPayload(payload, "none")).toBe(payload);
    expect(await decompressPayload(payload, "none")).toBe(payload);
  });

  it("throws CAS_INTEGRITY_FAILED on corrupt gzip input", async () => {
    const corrupt = new Uint8Array([0x1f, 0x8b, 0xff, 0xff, 0x00]);
    await expect(decompressPayload(corrupt, "gzip")).rejects.toThrowError(CasError);
  });
});

describe("applyAutoCompression", () => {
  it("keeps gzip when it pays for itself", async () => {
    const compressible = encoder.encode(makeText(100_000));
    const outcome = await applyAutoCompression(compressible, "gzip");
    expect(outcome.codec).toBe("gzip");
    expect(outcome.bytes.length).toBeLessThan(compressible.length * 0.9);
  });

  it("stores raw when compression does not pay off", async () => {
    // Cryptographically random bytes: gzip cannot shrink them meaningfully.
    const incompressible = new Uint8Array(randomBytes(4_096));
    const outcome = await applyAutoCompression(incompressible, "gzip");
    expect(outcome.codec).toBe("none");
    expect(outcome.bytes).toBe(incompressible);
  });

  it("bypasses non-gzip codecs", async () => {
    const payload = encoder.encode("plain");
    const outcome = await applyAutoCompression(payload, "none");
    expect(outcome.codec).toBe("none");
    expect(outcome.bytes).toBe(payload);
  });
});
