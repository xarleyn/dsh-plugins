/**
 * Minimal ZIP reader (central directory + per-entry inflate).
 *
 * The document pipeline inspects OOXML containers — `document_inspect` counts
 * headings and images, `security/file-types.ts` decides DOCX vs macro-enabled
 * DOCM — and neither may pull a ZIP dependency into the host plugin. Only the
 * two compression methods OOXML writers actually produce are supported
 * (stored and deflate); anything else is reported as unreadable instead of
 * being guessed at.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The end-of-central-directory record sits in the last 64 KiB (plus comment). */
const EOCD_SEARCH_BYTES = 65_557;
/** Guard against absurd declared sizes in a hostile archive. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - EOCD_SEARCH_BYTES);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Parse the central directory. Returns `undefined` when the buffer is not a
 * ZIP archive (or is truncated) — the caller decides whether that is an error.
 */
export function readZipEntries(buffer: Buffer): ZipEntry[] | undefined {
  if (buffer.length < 22) return undefined;
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return undefined;
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset === 0xffffffff || count === 0xffff) return undefined;
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length) return undefined;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return undefined;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    if (nameStart + nameLength > buffer.length) return undefined;
    entries.push({
      name: buffer.toString("utf8", nameStart, nameStart + nameLength),
      compressionMethod: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localHeaderOffset: buffer.readUInt32LE(cursor + 42),
    });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function findZipEntry(
  entries: readonly ZipEntry[],
  name: string,
): ZipEntry | undefined {
  const wanted = name.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === wanted);
}

/** Decompress one entry, or `undefined` when it is unreadable/oversized. */
export function readZipEntry(
  buffer: Buffer,
  entry: ZipEntry,
): Buffer | undefined {
  if (
    entry.compressedSize > MAX_ENTRY_BYTES ||
    entry.uncompressedSize > MAX_ENTRY_BYTES
  ) {
    return undefined;
  }
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length) return undefined;
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) return undefined;
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) return undefined;
  const payload = buffer.subarray(start, end);
  try {
    if (entry.compressionMethod === 0) return Buffer.from(payload);
    if (entry.compressionMethod === 8) return inflateRawSync(payload);
    return undefined;
  } catch {
    return undefined;
  }
}

/** Convenience: read a named entry from an archive in one call. */
export function readZipEntryByName(
  buffer: Buffer,
  name: string,
): Buffer | undefined {
  const entries = readZipEntries(buffer);
  if (entries === undefined) return undefined;
  const entry = findZipEntry(entries, name);
  if (entry === undefined) return undefined;
  return readZipEntry(buffer, entry);
}
