import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { decompressPayload } from "./compression.js";
import { CasError } from "./errors.js";
import { formatCasRef, sha256Hex } from "./hash.js";
import type { CasMetadata } from "./types.js";

const BLOCK = 32 * 1024;
const MEMORY_SNAPSHOT_LIMIT = 8 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const CACHE_ENTRIES = 16;

type Snapshot =
  | { readonly bytes: Uint8Array }
  | { readonly hashes: readonly string[]; readonly scratch?: string };

interface Entry {
  readonly version: string;
  readonly cost: number;
  readonly ready: Promise<Snapshot>;
  readers: number;
}

function integrityError(hash: string): CasError {
  return new CasError(
    "CAS_INTEGRITY_FAILED",
    `CAS object ${formatCasRef(hash)} failed its integrity check`,
  );
}

/** Anchor the page digests to the full logical SHA-256, including for pre-existing blobs. */
async function indexBlob(
  path: string,
  meta: CasMetadata,
  tempPath: () => string,
): Promise<Snapshot> {
  if (meta.storageCodec === "gzip" && meta.size <= MEMORY_SNAPSHOT_LIMIT) {
    const bytes = await decompressPayload(await readFile(path), "gzip");
    if (bytes.length !== meta.size || sha256Hex(bytes) !== meta.hash)
      throw integrityError(meta.hash);
    return { bytes };
  }

  // A legacy gzip stream has no seek table. Large streams get a disposable
  // seekable copy while verifying. Raw blobs are already seekable in place.
  const scratch = meta.storageCodec === "gzip" ? tempPath() : undefined;
  if (scratch) await mkdir(dirname(scratch), { recursive: true, mode: 0o700 });
  const handle = scratch ? await open(scratch, "wx", 0o600) : undefined;
  const hashes: string[] = [];
  const full = createHash("sha256");
  const block = Buffer.allocUnsafe(BLOCK);
  let used = 0;
  let size = 0;
  async function index(chunks: AsyncIterable<Buffer>) {
    for await (const chunk of chunks) {
      size += chunk.length;
      if (size > meta.size) throw integrityError(meta.hash);
      full.update(chunk);
      if (handle) await handle.writeFile(chunk);
      for (let offset = 0; offset < chunk.length;) {
        const copied = chunk.copy(block, used, offset, offset + BLOCK - used);
        used += copied;
        offset += copied;
        if (used === BLOCK) {
          hashes.push(sha256Hex(block));
          used = 0;
        }
      }
    }
  }
  try {
    try {
      const source = createReadStream(path);
      if (scratch) await pipeline(source, createGunzip(), index);
      else await pipeline(source, index);
      if (size !== meta.size || full.digest("hex") !== meta.hash)
        throw integrityError(meta.hash);
      if (used) hashes.push(sha256Hex(block.subarray(0, used)));
    } finally {
      await handle?.close();
    }
  } catch (error) {
    if (scratch) await unlink(scratch).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code?.startsWith("Z_"))
      throw integrityError(meta.hash);
    throw error;
  }
  return scratch ? { hashes, scratch } : { hashes };
}

/** Read only the intersecting blocks. Each block must still match the verified index. */
async function pageFrom(
  snapshot: Snapshot,
  path: string,
  meta: CasMetadata,
  offset: number,
  limit: number,
): Promise<Uint8Array> {
  if ("bytes" in snapshot)
    return Uint8Array.from(snapshot.bytes.subarray(offset, offset + limit));
  const first = Math.floor(offset / BLOCK);
  const start = first * BLOCK;
  const end = Math.min(meta.size, Math.ceil((offset + limit) / BLOCK) * BLOCK);
  const bytes = Buffer.allocUnsafe(end - start);
  const handle = await open(snapshot.scratch ?? path, "r");
  try {
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        filled,
        bytes.length - filled,
        start + filled,
      );
      if (bytesRead === 0) throw integrityError(meta.hash);
      filled += bytesRead;
    }
  } finally {
    await handle.close();
  }
  for (let i = 0; i < bytes.length; i += BLOCK) {
    if (
      sha256Hex(bytes.subarray(i, i + BLOCK)) !==
      snapshot.hashes[first + i / BLOCK]
    )
      throw integrityError(meta.hash);
  }
  return bytes.subarray(offset - start, offset - start + limit);
}

/** Per-store LRU. A reader keeps its snapshot alive across cache eviction. */
export class VerifiedPages {
  private readonly entries = new Map<string, Entry>();
  private cost = 0;
  private disposed = false;

  constructor(private readonly tempPath: () => string) {}

  async read(
    path: string,
    meta: CasMetadata,
    offset: number,
    limit: number,
  ): Promise<Uint8Array> {
    const stats = await stat(path, { bigint: true });
    const version = [
      stats.dev,
      stats.ino,
      stats.ctimeNs,
      stats.mtimeNs,
      stats.size,
      meta.size,
      meta.storageCodec,
    ].join("/");
    let entry = this.entries.get(meta.hash);
    if (entry?.version === version) {
      this.entries.delete(meta.hash);
      this.entries.set(meta.hash, entry);
    } else {
      this.forget(meta.hash);
      const cost =
        Math.ceil(meta.size / BLOCK) * 128 +
        (meta.storageCodec === "gzip" ? meta.size : 0);
      entry = {
        version,
        cost,
        ready: indexBlob(path, meta, this.tempPath),
        readers: 0,
      };
      // The store can close while the metadata or blob stat is in flight.
      // That reader may finish, but must release its own scratch file.
      if (!this.disposed) {
        this.entries.set(meta.hash, entry);
        this.cost += cost;
        while (
          this.entries.size > 1 &&
          (this.entries.size > CACHE_ENTRIES || this.cost > CACHE_BYTES)
        ) {
          this.forget(this.entries.keys().next().value!);
        }
      }
    }
    entry.readers++;
    try {
      return await pageFrom(await entry.ready, path, meta, offset, limit);
    } catch (error) {
      if (this.entries.get(meta.hash) === entry) this.forget(meta.hash);
      throw error;
    } finally {
      entry.readers--;
      if (entry.readers === 0 && this.entries.get(meta.hash) !== entry)
        this.cleanup(entry);
    }
  }

  forget(hash: string): void {
    const entry = this.entries.get(hash);
    if (!entry) return;
    this.entries.delete(hash);
    this.cost -= entry.cost;
    if (!entry.readers) this.cleanup(entry);
  }

  dispose(): void {
    this.disposed = true;
    for (const hash of this.entries.keys()) this.forget(hash);
  }

  private cleanup(entry: Entry): void {
    // Crashes or an unavailable filesystem leave ordinary tmp files for the
    // store's existing orphan sweep. An active reader always finishes first.
    void entry.ready
      .then(async (snapshot) => {
        if ("scratch" in snapshot && snapshot.scratch)
          await unlink(snapshot.scratch);
      })
      .catch(() => undefined);
  }
}
