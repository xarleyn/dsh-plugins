/**
 * Minimal ZIP reader (central directory + per-entry inflate) used to pull the
 * one XML part an office document keeps its text in. Node's `zlib` provides the
 * inflate; nothing here needs a ZIP library, and a document never has to be
 * written to disk to be read.
 *
 * Deliberately tolerant: entry CRCs are not verified and a damaged entry is
 * reported as `undefined` rather than thrown, because the alternative — a
 * failed fetch because one unrelated part of an archive is odd — costs the
 * model the whole document.
 * @module documents/zip
 */

import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
/** EOCD comment field is at most 64 KiB, so the record starts within that window. */
const MAX_COMMENT_WINDOW = 65_557;

export interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

/**
 * List the ZIP entries whose central directory is readable. Returns an empty
 * list for anything that is not a ZIP archive.
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = findEndOfCentralDirectory(view);
  if (start === undefined) return [];
  const entryCount = view.getUint16(start + 10, true);
  let offset = view.getUint32(start + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength) break;
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) break;
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Read and inflate one entry by exact name, or `undefined` when the archive has
 * no such entry or the entry cannot be decoded. `maxBytes` caps the inflated
 * size, so a decompression bomb costs a bounded amount of memory.
 */
export function readZipEntry(
  bytes: Uint8Array,
  name: string,
  maxBytes: number,
): Uint8Array | undefined {
  const entry = readZipEntries(bytes).find(
    (candidate) => candidate.name === name,
  );
  if (entry === undefined) return undefined;
  return readEntryBytes(bytes, entry, maxBytes);
}

/** Read one already-listed entry. */
export function readEntryBytes(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxBytes: number,
): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.byteLength) return undefined;
  if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) return undefined;
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  // A streamed entry reports 0 in the local header and keeps the real sizes in
  // a data descriptor; the central directory is authoritative either way.
  const size = entry.compressedSize;
  if (dataStart + size > bytes.byteLength) return undefined;
  const payload = bytes.subarray(dataStart, dataStart + size);
  if (entry.compressionMethod === 0) {
    return payload.byteLength > maxBytes
      ? payload.subarray(0, maxBytes)
      : payload;
  }
  if (entry.compressionMethod !== 8) return undefined;
  try {
    return inflateRawSync(payload, {
      maxOutputLength: Math.max(1, Math.min(maxBytes, 64 * 1024 * 1024)),
    });
  } catch {
    return undefined;
  }
}

function findEndOfCentralDirectory(view: DataView): number | undefined {
  const lowest = Math.max(0, view.byteLength - MAX_COMMENT_WINDOW);
  for (let offset = view.byteLength - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY)
      return offset;
  }
  return undefined;
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
