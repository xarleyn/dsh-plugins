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

import {
  lstat,
  mkdir,
  opendir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import {
  applyAutoCompression,
  compressPayload,
  decompressPayload,
  type CompressionMode,
  resolveCodec,
} from "./compression.js";
import { CasError } from "./errors.js";
import { assertValidHash, formatCasRef, sha256Hex } from "./hash.js";
import {
  isMissing,
  publishFile,
  removeStalePublication,
} from "./publish-file.js";
import { VerifiedPages } from "./verified-pages.js";
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
  StorageCodec,
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

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function matchesPayload(
  stored: Buffer,
  codec: StorageCodec,
  payload: Uint8Array,
): Promise<boolean> {
  if (codec === "none") return stored.equals(payload);
  try {
    return (
      Buffer.compare(await decompressPayload(stored, codec), payload) === 0
    );
  } catch (error) {
    if (error instanceof CasError && error.code === "CAS_INTEGRITY_FAILED")
      return false;
    throw error;
  }
}

export class FilesystemCasStore implements CasStore {
  private readonly root: string;
  private readonly compression: CompressionMode;
  private readonly now: () => Date;
  private readonly pages = new VerifiedPages(() => this.tmpPath());

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
    return join(
      this.root,
      "blobs",
      "sha256",
      hash.slice(0, SHARD_WIDTH),
      hash.slice(SHARD_WIDTH, SHARD_WIDTH * 2),
      `${hash}.blob`,
    );
  }

  private metaPath(hash: string): string {
    assertValidHash(hash);
    return join(
      this.root,
      "meta",
      "sha256",
      hash.slice(0, SHARD_WIDTH),
      hash.slice(SHARD_WIDTH, SHARD_WIDTH * 2),
      `${hash}.json`,
    );
  }

  private tmpPath(): string {
    return join(
      this.root,
      "tmp",
      `cas-${process.pid.toString(16)}-${randomBytes(8).toString("hex")}.tmp`,
    );
  }

  private async ensureRoots(): Promise<void> {
    // 0o700 where the platform honors modes (SPEC §25).
    for (const dir of [
      this.root,
      join(this.root, "blobs", "sha256"),
      join(this.root, "meta", "sha256"),
      join(this.root, "tmp"),
    ]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    }
  }

  async put(input: CasPutInput): Promise<CasObject> {
    try {
      return await this.putUnchecked(input);
    } catch (error) {
      if (error instanceof CasError) throw error;
      throw new CasError(
        "CAS_STORE_IO",
        `failed to store payload: ${String(error)}`,
      );
    }
  }

  private async putUnchecked(input: CasPutInput): Promise<CasObject> {
    await this.ensureRoots();
    const hash = sha256Hex(input.payload);
    const blobPath = this.blobPath(hash);
    const metaPath = this.metaPath(hash);
    let metadata = await this.readMeta(hash).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    if (metadata && metadata.size === input.payload.length) {
      const info = await stat(blobPath).catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      // This store keeps gzip only if it saves space. A crossed raw/gzip
      // pair therefore cannot have both the recorded size and codec shape.
      const plausibleSize =
        metadata.storageCodec === "none"
          ? metadata.storedSize === metadata.size
          : metadata.storedSize < metadata.size;
      if (info?.isFile() && info.size === metadata.storedSize && plausibleSize)
        return this.finishPut(metadata, input.payload.length, info.size, false);
    }
    let stored = await readIfPresent(blobPath);
    let prepared: { codec: StorageCodec; bytes: Uint8Array } | undefined;

    if (!metadata) {
      if (stored) {
        // A pre-existing writer could leave a complete blob before publishing
        // its metadata. Identify it by content, including raw gzip-shaped data.
        const codec = stored.equals(input.payload) ? "none" : "gzip";
        if (!(await matchesPayload(stored, codec, input.payload)))
          throw new CasError(
            "CAS_INTEGRITY_FAILED",
            `unrecognized blob for ${formatCasRef(hash)}`,
          );
        prepared = { bytes: stored, codec };
      } else {
        const codec = resolveCodec(
          this.compression,
          input.kind,
          input.mediaType,
        );
        prepared = await applyAutoCompression(input.payload, codec);
      }
      const timestamp = this.now().toISOString();
      const proposed: CasMetadata = {
        version: META_VERSION,
        algorithm: "sha256",
        hash,
        size: input.payload.length,
        storedSize: prepared.bytes.length,
        kind: input.kind,
        mediaType: input.mediaType,
        encoding: input.encoding,
        storageCodec: prepared.codec,
        createdAt: timestamp,
        lastAccessedAt: timestamp,
        firstTool: input.firstTool ?? null,
        hits: 0,
      };
      const bytes = Buffer.from(`${JSON.stringify(proposed, null, 2)}\n`);
      // Elect one immutable representation before any writer publishes the
      // blob. A subsequent put can complete a writer interrupted between them.
      await this.publishBytes(metaPath, bytes);
      metadata = await this.readMeta(hash);
    }

    const chosen = metadata;
    const encoded = async () =>
      prepared?.codec === chosen.storageCodec
        ? prepared.bytes
        : compressPayload(input.payload, chosen.storageCodec);
    if (!stored) {
      const bytes = await encoded();
      if (await this.publishBytes(blobPath, bytes)) {
        const storedSize = (await stat(blobPath)).size;
        return this.finishPut(chosen, input.payload.length, storedSize, true);
      }
      stored = await readFile(blobPath);
    }
    if (await matchesPayload(stored, chosen.storageCodec, input.payload))
      return this.finishPut(chosen, input.payload.length, stored.length, false);
    // Repair a mismatched legacy pair from the caller's original bytes.
    // All concurrent repairs use the same elected codec.
    const bytes = await encoded();
    await this.publishBytes(blobPath, bytes, true);
    return this.finishPut(chosen, input.payload.length, bytes.length, true);
  }

  private async finishPut(
    metadata: CasMetadata,
    size: number,
    storedSize: number,
    wroteBlob: boolean,
  ): Promise<CasObject> {
    const corrected =
      metadata.size !== size || metadata.storedSize !== storedSize;
    if (corrected || !wroteBlob) {
      const updated = {
        ...metadata,
        size,
        storedSize,
        hits: metadata.hits + (wroteBlob ? 0 : 1),
        lastAccessedAt: this.now().toISOString(),
      };
      try {
        metadata = await this.writeMeta(metadata.hash, updated);
      } catch (error) {
        if (corrected) throw error;
      }
    }
    return { ref: formatCasRef(metadata.hash), metadata, reused: !wroteBlob };
  }

  private async publishBytes(
    destination: string,
    bytes: Uint8Array,
    replace = false,
  ): Promise<boolean> {
    const tmp = this.tmpPath();
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (!replace) return await publishFile(tmp, destination);
      await rename(tmp, destination);
      return true;
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
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

  async read(
    hash: string,
    options: CasReadOptions = {},
  ): Promise<CasReadResult> {
    assertValidHash(hash);
    const meta = await this.stat(hash);
    if (meta === null) {
      throw new CasError(
        "CAS_OBJECT_MISSING",
        `CAS object ${formatCasRef(hash)} is not available`,
      );
    }
    const offset = clamp(options.offset ?? 0, 0, meta.size);
    const limit = clamp(
      options.limit ?? Number.MAX_SAFE_INTEGER,
      0,
      meta.size - offset,
    );
    let payload: Uint8Array;
    try {
      payload = await this.readWindow(
        meta,
        offset,
        limit,
        options.verify !== false,
      );
    } catch (error) {
      if (error instanceof CasError) throw error;
      throw new CasError(
        "CAS_STORE_IO",
        `failed to read blob ${formatCasRef(hash)}: ${String(error)}`,
      );
    }
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

  private async readWindow(
    meta: CasMetadata,
    offset: number,
    limit: number,
    verify: boolean,
  ): Promise<Uint8Array> {
    const path = this.blobPath(meta.hash);
    if (verify && limit < meta.size) {
      try {
        return await this.pages.read(path, meta, offset, limit);
      } catch (error) {
        // A read-only/full mount can still serve an old gzip blob. Also
        // recover if another process swept an idle scratch copy.
        if (
          !["ENOENT", "EROFS", "EPERM", "EACCES", "ENOSPC", "EDQUOT"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
    const bytes = await decompressPayload(
      await readFile(path),
      meta.storageCodec,
    );
    if (
      verify &&
      (bytes.length !== meta.size || sha256Hex(bytes) !== meta.hash)
    ) {
      throw new CasError(
        "CAS_INTEGRITY_FAILED",
        `CAS object ${formatCasRef(meta.hash)} failed its integrity check`,
      );
    }
    return bytes.subarray(offset, offset + limit);
  }

  /** Drop process-local range indexes and disposable decoded files. */
  dispose(): void {
    this.pages.dispose();
  }

  async search(hash: string, query: CasSearchQuery): Promise<CasSearchResult> {
    assertValidHash(hash);
    if (query.query.length === 0) {
      throw new CasError(
        "CAS_INVALID_ARGUMENT",
        "search query must not be empty",
      );
    }
    const maxMatches = clamp(
      query.maxMatches ?? SEARCH_DEFAULT_MAX_MATCHES,
      1,
      200,
    );
    const contextLines = clamp(
      query.contextLines ?? SEARCH_DEFAULT_CONTEXT_LINES,
      0,
      20,
    );
    const whole = await this.read(hash, { verify: true });
    const text = new TextDecoder("utf8", { fatal: false }).decode(whole.bytes);
    const lines = text.split(/\r\n|\r|\n/);
    const needle =
      query.caseSensitive === true ? query.query : query.query.toLowerCase();

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
        before: lines
          .slice(Math.max(0, index - contextLines), index)
          .map(truncateLine),
        after: lines
          .slice(index + 1, index + 1 + contextLines)
          .map(truncateLine),
      };
      const entryChars =
        entry.text.length +
        entry.before.join("").length +
        entry.after.join("").length;
      if (outputChars + entryChars > SEARCH_MAX_OUTPUT_BYTES) continue;
      outputChars += entryChars;
      matches.push(entry);
    }
    const truncated = totalMatches > matches.length;
    return {
      ref: formatCasRef(hash),
      totalMatches,
      returnedMatches: matches.length,
      truncated,
      matches,
    };
  }

  async touch(hash: string, accessedAt: Date = this.now()): Promise<void> {
    assertValidHash(hash);
    const meta = await this.readMeta(hash).catch(() => undefined);
    if (meta === undefined) return;
    await this.writeMeta(hash, {
      ...meta,
      lastAccessedAt: accessedAt.toISOString(),
    });
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

    const totalLogical = survivors.reduce(
      (sum, entry) => sum + entry.meta.size,
      0,
    );
    if (totalLogical > options.maxBytes) {
      // Quota eviction: oldest last access first (SPEC §24). Once the store
      // stays over quota after routine GC, minAge stops protecting objects.
      const byOldest = [...survivors].sort(
        (a, b) =>
          Date.parse(a.meta.lastAccessedAt) - Date.parse(b.meta.lastAccessedAt),
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
    return {
      objects: entries.length,
      logicalBytes,
      storedBytes,
      largestObjectBytes,
      hits,
    };
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
          const info = await lstat(path);
          if (now - info.mtimeMs > TMP_ORPHAN_AGE_MS) {
            if (info.isDirectory()) {
              if (!(await removeStalePublication(path))) continue;
            } else await unlink(path);
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
    if (
      parsed?.version !== META_VERSION ||
      parsed.hash !== hash ||
      typeof parsed.size !== "number"
    ) {
      throw new CasError(
        "CAS_INTEGRITY_FAILED",
        `unreadable metadata for ${formatCasRef(hash)}`,
      );
    }
    return parsed;
  }

  private async writeMeta(
    hash: string,
    metadata: CasMetadata,
  ): Promise<CasMetadata> {
    const path = this.metaPath(hash);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = this.tmpPath();
    try {
      await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tmp, path);
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
          if (meta !== undefined)
            entries.push({ hash, path: this.metaPath(hash), meta });
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
      if (entry.name.length === SHARD_WIDTH && !entry.name.startsWith("."))
        names.push(entry.name);
    }
    return names.sort();
  }

  private async deleteObject(entry: MetaDirEntry): Promise<boolean> {
    this.pages.forget(entry.hash);
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
