/**
 * On-disk storage codecs (SPEC §17).
 *
 * Identity is computed over the logical payload before compression; the codec
 * choice only affects the stored representation and is recorded in metadata.
 */

import { gzip as gzipCallback, gunzip as gunzipCallback } from "node:zlib";
import { promisify } from "node:util";

import type { CasKind, StorageCodec } from "./types.js";
import { CasError } from "./errors.js";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

export type CompressionMode = "none" | "gzip" | "auto";

/** Media types whose payloads are already compressed; `auto` stores them raw. */
const COMPRESSED_MEDIA_PREFIXES = ["image/", "video/", "audio/", "application/zip", "application/gzip", "application/x-gzip", "application/pdf"] as const;

export function isPreCompressedMedia(mediaType: string): boolean {
  const lower = mediaType.toLowerCase();
  return COMPRESSED_MEDIA_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Resolve the codec for a new object without considering content (fast path). */
export function resolveCodec(mode: CompressionMode, kind: CasKind, mediaType: string): StorageCodec {
  if (mode === "none") return "none";
  if (mode === "gzip") return "gzip";
  if (kind === "binary" && isPreCompressedMedia(mediaType)) return "none";
  return "gzip";
}

export async function compressPayload(bytes: Uint8Array, codec: StorageCodec): Promise<Uint8Array> {
  if (codec === "none") return bytes;
  try {
    return new Uint8Array(await gzip(bytes));
  } catch (error) {
    throw new CasError("CAS_STORE_IO", `gzip compression failed: ${String(error)}`);
  }
}

export async function decompressPayload(bytes: Uint8Array, codec: StorageCodec): Promise<Uint8Array> {
  if (codec === "none") return bytes;
  try {
    return new Uint8Array(await gunzip(bytes));
  } catch (error) {
    throw new CasError("CAS_INTEGRITY_FAILED", `stored blob failed to decompress: ${String(error)}`);
  }
}

/**
 * `auto` refinement: textual content is compressed only when the attempt
 * actually pays for itself; otherwise the raw bytes are stored.
 */
export async function applyAutoCompression(
  bytes: Uint8Array,
  codec: StorageCodec,
): Promise<{ bytes: Uint8Array; codec: StorageCodec }> {
  if (codec !== "gzip") return { bytes, codec: "none" };
  const compressed = await compressPayload(bytes, "gzip");
  // Keep compression only when it saves at least 10% of the payload.
  if (compressed.length >= bytes.length * 0.9) return { bytes, codec: "none" };
  return { bytes: compressed, codec: "gzip" };
}
