/**
 * Filesystem content-addressed store (SPEC §14-§17, §24, §26).
 *
 * Layout under the store root:
 *
 *     blobs/sha256/<ab>/<cd>/<hash>.blob   payload (optionally gzip-compressed)
 *     meta/sha256/<ab>/<cd>/<hash>.json    informative metadata (SPEC §15)
 *     tmp/                                 staging area for atomic writes
 *
 * Paths are derived solely from validated SHA-256 hashes. Writes stage into
 * `tmp/` and are committed with an exclusive hard link (falling back to an
 * atomic rename), so concurrent writers of identical content converge on one
 * blob without corrupting it. Every storage failure throws `CasError`; callers
 * fail open with the original tool result (SPEC §26).
 */

import { mkdir, opendir, open, readFile, rename, link, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import { applyAutoCompression, decompressPayload, type CompressionMode, resolveCodec } from "./compression.js";
import { CasError } from "./errors.js";
import { assertValidHash, formatCasRef, sha256Hex } from "./hash.js";
import type {
  CasGcOptions,
  CasGcResult,
  CasMetadata,
  CasPutInput,
  CasObject,
  CasReadOptions,
  CasReadResult,
  CasSearchMatch,
  CasSearchQuery,
  CasSearchResult,
  CasStore,
  CasStoreStats,
} from "./types.js";

const META_VERSION = 1;
/** Directories are sharded by the first two / next two hex characters. */
const SHARD_WIDTH = 2;
/** Search output caps (SPEC §25). */
const SEARCH_DEFAULT_MAX_MATCHES = 20;
const SEARCH_DEFAULT_CONTEXT_LINES = 3;
const SEARCH_MAX_LINE_LENGTH = 400;
const SEARCH_MAX_OUTPUT_BYTES = 65_536;
/** Temporary staging files older than this are removed on startup/GC. */
const TMP_ORPHAN_AGE_MS = 3_600_000;

export interface FilesystemCasStoreOptions {
  readonly compression: CompressionMode;
  readonly now?: () => Date;
}

interface MetaDirEntry {
  readonly hash: string;
  readonly path: string;
  readonly meta: CasMetadata;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function truncateLine(line: string): string {
  return line.length > SEARCH_MAX_LINE_LENGTH
    ? `${line.slice(0, SEARCH_MAX_LINE_LENGTH)}…`
    : line;
}

export class FilesystemCasStore implements CasStore {
  private readonly root: string;
  private readonly compression: CompressionMode;
  private readonly now: () => Date;

  constructor(root: string, options: FilesystemCasStoreOptions) {
    this.root = root;
    this.compression = options.compression;
    this.now = options.now ?? (() => new Date());
  }

  get storeRoot(): string {
    return this.root;
  }

  private blobPath(hash: string): string {
    assertValidHash(hash);
    return join(this.root, "blobs", "sha256", hash.slice(0, SHARD_WIDTH), hash.slice(SHARD_WIDTH, SHARD_WIDTH * 2), `${hash}.blob`);
  }

  private metaPath(hash: string): string {
    assertValidHash(hash);
    return join(this.root, "meta", "sha256", hash.slice(0, SHARD_WIDTH), hash.slice(SHARD_WIDTH, SHARD_WIDTH * 2), `${hash}.json`);
  }

  private tmpPath(): string {
    return join(this.root, "tmp", `cas-${process.pid.toString(16)}-${randomBytes(8).toString("hex")}.tmp`);
  }

  private async ensureRoots(): Promise<void> {
    // 0o700 where the platform honors modes (SPEC §25).
    for (const dir of [this.root, join(this.root, "blobs", "sha256"), join(this.root, "meta", "sha256"), join(this.root, "tmp")]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  async put(input: CasPutInput): Promise<CasObject> {
    try {
      return await this.putUnchecked(input);
    } catch (error) {
      if (error instanceof CasError) throw error;
      throw new CasError("CAS_STORE_IO", `failed to store payload: ${String(error)}`);
    }
  }

  private async putUnchecked(input: CasPutInput): Promise<CasObject> {
    await this.ensureRoots();
    const hash = sha256Hex(input.payload);
    const existing = await this.readMeta(hash).catch(() => undefined);
    if (existing !== undefined && (await this.blobExists(hash))) {
      // Storage deduplication: identical payload is stored once (SPEC §13).
      const timestamp = this.now();
      const updated = await this.writeMeta(hash, {
        ...existing,
        hits: existing.hits + 1,
        lastAccessedAt: timestamp.toISOString(),
      }).catch(() => ({ ...existing, hits: existing.hits + 1 }));
      return { ref: formatCasRef(hash), metadata: updated, reused: true };
    }

    const codec = resolveCodec(this.compression, input.kind, input.mediaType);
    const { bytes: storedBytes, codec: effectiveCodec } =
      codec === "gzip"
        ? await applyAutoCompression(input.payload, "gzip")
        : { bytes: input.payload, codec: "none" as const };
    const timestamp = this.now().toISOString();
    const metadata: CasMetadata = {
      version: META_VERSION,
      algorithm: "sha256",
      hash,
      size: input.payload.length,
      storedSize: storedBytes.length,
      kind: input.kind,
      mediaType: input.mediaType,
      encoding: input.encoding,
      storageCodec: effectiveCodec,
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      firstTool: input.firstTool ?? null,
      hits: 0,
    };

    const tmp = this.tmpPath();
    const finalBlob = this.blobPath(hash);
    await mkdir(dirname(finalBlob), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(storedBytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Exclusive commit: when the link loses the race against a concurrent
      // writer, their identical blob stays in place. Without hard-link
      // support the staged file is renamed atomically over the target;
      // clobbering an identical payload is benign. A rename refusal on
      // Windows (EPERM while the target is being replaced concurrently) is
      // only fatal when no equivalent blob actually appeared.
      try {
        await link(tmp, finalBlob);
      } catch {
        try {
          await rename(tmp, finalBlob);
        } catch {
          if (!(await this.blobExists(hash))) {
            throw new CasError("CAS_STORE_IO", `failed to commit blob ${formatCasRef(hash)}`);
          }
        }
      }
    } finally {
      await unlink(tmp).catch(() => undefined);
    }

    try {
      await this.writeMeta(hash, metadata);
    } catch (error) {
      // Never keep a blob that cannot be served back with its metadata
      // (SPEC §26): remove it and fail so the caller passes the original
      // tool result through.
      await unlink(finalBlob).catch(() => undefined);
      throw new CasError("CAS_STORE_IO", `metadata write failed for ${formatCasRef(hash)}: ${String(error)}`);
    }
    return { ref: formatCasRef(hash), metadata, reused: false };
  }

  async has(hash: string): Promise<boolean> {
    return this.blobExists(assertValidHash(hash));
  }

  async stat(hash: string): Promise<CasMetadata | null> {
    assertValidHash(hash);
    const meta = await this.readMeta(hash).catch(() => undefined);
    if (meta === undefined) return null;
    if (!(await this.blobExists(hash))) return null;
    return meta;
  }

  async read(hash: string, options: CasReadOptions = {}): Promise<CasReadResult> {
    assertValidHash(hash);
    const meta = await this.stat(hash);
    if (meta === null) {
      throw new CasError("CAS_OBJECT_MISSING", `CAS object ${formatCasRef(hash)} is not available`);
    }
    let stored: Uint8Array;
    try {
      stored = await readFile(this.blobPath(hash));
    } catch (error) {
      throw new CasError("CAS_STORE_IO", `failed to read blob ${formatCasRef(hash)}: ${String(error)}`);
    }
    let payload = await decompressPayload(stored, meta.storageCodec);
    if (options.verify !== false) {
      const actual = sha256Hex(payload);
      if (actual !== hash) {
        throw new CasError("CAS_INTEGRITY_FAILED", `CAS object ${formatCasRef(hash)} failed its integrity check`);
      }
    }
    const offset = Math.min(Math.max(options.offset ?? 0, 0), payload.length);
    const limit = clamp(options.limit ?? Number.MAX_SAFE_INTEGER, 0, payload.length - offset);
    payload = payload.subarray(offset, offset + limit);
    void this.touch(hash, this.now()).catch(() => undefined);
    return {
      ref: formatCasRef(hash),
      kind: meta.kind,
      mediaType: meta.mediaType,
      encoding: meta.encoding,
      offset,
      totalSize: meta.size,
      truncated: offset + payload.length < meta.size,
      bytes: payload,
    };
  }

  async search(hash: string, query: CasSearchQuery): Promise<CasSearchResult> {
    assertValidHash(hash);
    if (query.query.length === 0) {
      throw new CasError("CAS_INVALID_ARGUMENT", "search query must not be empty");
    }
    const maxMatches = clamp(query.maxMatches ?? SEARCH_DEFAULT_MAX_MATCHES, 1, 200);
    const contextLines = clamp(query.contextLines ?? SEARCH_DEFAULT_CONTEXT_LINES, 0, 20);
    const whole = await this.read(hash, { verify: true });
    const text = new TextDecoder("utf8", { fatal: false }).decode(whole.bytes);
    const lines = text.split(/\r\n|\r|\n/);
    const needle = query.caseSensitive === true ? query.query : query.query.toLowerCase();

    const matches: CasSearchMatch[] = [];
    let totalMatches = 0;
    let outputChars = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const haystack = query.caseSensitive === true ? line : line.toLowerCase();
      if (!haystack.includes(needle)) continue;
      totalMatches += 1;
      if (matches.length >= maxMatches) continue;
      const entry: CasSearchMatch = {
        line: index + 1,
        text: truncateLine(line),
        before: lines.slice(Math.max(0, index - contextLines), index).map(truncateLine),
        after: lines.slice(index + 1, index + 1 + contextLines).map(truncateLine),
      };
      const entryChars = entry.text.length + entry.before.join("").length + entry.after.join("").length;
      if (outputChars + entryChars > SEARCH_MAX_OUTPUT_BYTES) continue;
      outputChars += entryChars;
      matches.push(entry);
    }
    const truncated = totalMatches > matches.length;
    return { ref: formatCasRef(hash), totalMatches, returnedMatches: matches.length, truncated, matches };
  }

  async touch(hash: string, accessedAt: Date = this.now()): Promise<void> {
    assertValidHash(hash);
    const meta = await this.readMeta(hash).catch(() => undefined);
    if (meta === undefined) return;
    await this.writeMeta(hash, { ...meta, lastAccessedAt: accessedAt.toISOString() });
  }

  async gc(options: CasGcOptions): Promise<CasGcResult> {
    await this.ensureRoots();
    const now = options.now ?? this.now().getTime();
    const entries = await this.scanMeta();
    let deletedObjects = 0;
    let freedBytes = 0;
    const survivors: MetaDirEntry[] = [];

    for (const entry of entries) {
      const age = now - Date.parse(entry.meta.lastAccessedAt);
      const expired = Number.isNaN(age) || age > options.ttlMs;
      const protectable = !Number.isNaN(age) && age <= options.minAgeMs;
      if (expired && !protectable && (await this.deleteObject(entry))) {
        deletedObjects += 1;
        freedBytes += entry.meta.size;
        continue;
      }
      survivors.push(entry);
    }

    const totalLogical = survivors.reduce((sum, entry) => sum + entry.meta.size, 0);
    if (totalLogical > options.maxBytes) {
      // Quota eviction: oldest last access first (SPEC §24). Once the store
      // stays over quota after routine GC, minAge stops protecting objects.
      const byOldest = [...survivors].sort(
        (a, b) => Date.parse(a.meta.lastAccessedAt) - Date.parse(b.meta.lastAccessedAt),
      );
      let remaining = totalLogical;
      for (const entry of byOldest) {
        if (remaining <= options.maxBytes) break;
        if (await this.deleteObject(entry)) {
          deletedObjects += 1;
          freedBytes += entry.meta.size;
          remaining -= entry.meta.size;
        }
      }
    }

    await this.cleanTmpOrphans(now);
    return { scannedObjects: entries.length, deletedObjects, freedBytes };
  }

  async stats(): Promise<CasStoreStats> {
    const entries = await this.scanMeta();
    let logicalBytes = 0;
    let storedBytes = 0;
    let largestObjectBytes = 0;
    let hits = 0;
    for (const entry of entries) {
      logicalBytes += entry.meta.size;
      storedBytes += entry.meta.storedSize;
      largestObjectBytes = Math.max(largestObjectBytes, entry.meta.size);
      hits += entry.meta.hits;
    }
    return { objects: entries.length, logicalBytes, storedBytes, largestObjectBytes, hits };
  }

  /** Remove interrupted staging files left behind by crashed writers. */
  async cleanTmpOrphans(now: number = this.now().getTime()): Promise<number> {
    let removed = 0;
    let dir;
    try {
      dir = await opendir(join(this.root, "tmp"));
    } catch {
      return 0;
    }
    try {
      for await (const entry of dir) {
        const path = join(this.root, "tmp", entry.name);
        try {
          const info = await stat(path);
          if (now - info.mtimeMs > TMP_ORPHAN_AGE_MS) {
            await unlink(path);
            removed += 1;
          }
        } catch {
          // Unlinkable entries are skipped; the next pass retries.
        }
      }
    } catch {
      // Directory vanished mid-scan; nothing to do.
    }
    return removed;
  }

  private async blobExists(hash: string): Promise<boolean> {
    try {
      const info = await stat(this.blobPath(hash));
      return info.isFile();
    } catch {
      return false;
    }
  }

  private async readMeta(hash: string): Promise<CasMetadata> {
    const raw = await readFile(this.metaPath(hash), "utf8");
    const parsed = JSON.parse(raw) as CasMetadata;
    if (parsed?.version !== META_VERSION || parsed.hash !== hash || typeof parsed.size !== "number") {
      throw new CasError("CAS_INTEGRITY_FAILED", `unreadable metadata for ${formatCasRef(hash)}`);
    }
    return parsed;
  }

  private async writeMeta(hash: string, metadata: CasMetadata): Promise<CasMetadata> {
    const path = this.metaPath(hash);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = this.tmpPath();
    try {
      await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        await rename(tmp, path);
      } catch {
        // Lost the replace race against a concurrent writer committing the
        // same payload; either writer's metadata serves identical content.
        const committed = await stat(path).then(
          () => true,
          () => false,
        );
        if (!committed) throw new CasError("CAS_STORE_IO", `failed to commit metadata for ${formatCasRef(hash)}`);
      }
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    return metadata;
  }

  private async scanMeta(): Promise<MetaDirEntry[]> {
    const entries: MetaDirEntry[] = [];
    const metaRoot = join(this.root, "meta", "sha256");
    for (const level1 of await this.listShards(metaRoot)) {
      for (const level2 of await this.listShards(join(metaRoot, level1))) {
        const shardDir = join(metaRoot, level1, level2);
        let dir;
        try {
          dir = await opendir(shardDir);
        } catch {
          continue;
        }
        for await (const entry of dir) {
          if (!entry.name.endsWith(".json")) continue;
          const hash = entry.name.slice(0, -".json".length);
          const meta = await this.readMeta(hash).catch(() => undefined);
          if (meta !== undefined) entries.push({ hash, path: this.metaPath(hash), meta });
        }
      }
    }
    return entries;
  }

  private async listShards(parent: string): Promise<string[]> {
    let dir;
    try {
      dir = await opendir(parent);
    } catch {
      return [];
    }
    const names: string[] = [];
    for await (const entry of dir) {
      if (entry.name.length === SHARD_WIDTH && !entry.name.startsWith(".")) names.push(entry.name);
    }
    return names.sort();
  }

  private async deleteObject(entry: MetaDirEntry): Promise<boolean> {
    try {
      await unlink(this.blobPath(entry.hash));
    } catch {
      // Blob already gone; still drop the stale metadata below.
    }
    try {
      await unlink(entry.path);
    } catch {
      return false;
    }
    return true;
  }
}
