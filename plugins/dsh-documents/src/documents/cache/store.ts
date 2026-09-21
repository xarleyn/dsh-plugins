/**
 * The conversion cache: entries under `<artifact root>/.cache/`.
 *
 * One JSON file per conversion, named by the key digest, plus the artifacts it
 * points at. Nothing is copied here: an entry records *where* the produced
 * file lives and what it hashes to, and a hit copies those bytes into the new
 * bundle. That keeps one owner per byte — the artifact store — so retention,
 * path containment and the manifests keep working exactly as before, and a
 * deleted artifact can never be served from a stale copy.
 *
 * The store is deliberately forgiving: a missing, torn or unreadable entry is
 * a miss, not an error, because the fallback (run the backend again) is always
 * correct. Only writes fail loudly, and the caller decides what to do about it.
 */

import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { assertInsideRoot } from "../security/paths.js";
import { CACHE_DIRECTORY, CACHE_ENTRY_VERSION } from "./key.js";
import type { DocumentCacheEntry } from "./key.js";

export interface CacheStoreOptions {
  /** Absolute artifact root; the cache lives directly beneath it. */
  readonly root: string;
  readonly maxAgeDays: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  /** Directory name under the root; overridable so tests can isolate stores. */
  readonly directory?: string;
}

export interface CachePruneReport {
  readonly expired: number;
  readonly overflowed: number;
  readonly unreadable: number;
}

const ENTRY_FILE_SUFFIX = ".json";

export class CacheStore {
  readonly root: string;
  private readonly directory: string;
  private readonly maxAgeMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: CacheStoreOptions) {
    this.root = path.resolve(options.root);
    this.directory = options.directory ?? CACHE_DIRECTORY;
    this.maxAgeMs = options.maxAgeDays * 86_400_000;
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
  }

  /** Absolute path of the cache directory (created on demand). */
  dir(): string {
    return assertInsideRoot(
      this.root,
      path.resolve(this.root, this.directory),
      "cache directory",
    );
  }

  private entryPath(key: string): string {
    return assertInsideRoot(
      this.dir(),
      path.resolve(this.dir(), `${key}${ENTRY_FILE_SUFFIX}`),
      "cache entry",
    );
  }

  /** Read one entry; `undefined` covers absent, unreadable and stale entries. */
  async get(key: string): Promise<DocumentCacheEntry | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.entryPath(key), "utf8");
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as DocumentCacheEntry;
      if (
        parsed.version !== CACHE_ENTRY_VERSION ||
        parsed.key !== key ||
        !Array.isArray(parsed.outputs) ||
        parsed.outputs.length === 0
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  /**
   * Write one entry atomically and prune the directory afterwards.
   *
   * `now` is the caller's clock, and it must be the same one that stamped the
   * entry: pruning compares the two, so mixing the injected session clock with
   * the wall clock would expire entries the moment they were written.
   */
  async put(entry: DocumentCacheEntry, now: Date = new Date()): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    const target = this.entryPath(entry.key);
    const temp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(temp, `${JSON.stringify(entry, null, 2)}\n`);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    await this.prune(now);
  }

  /** Record a hit: refresh the access time and the hit counter. */
  async refresh(entry: DocumentCacheEntry, now: Date): Promise<void> {
    await this.put(
      {
        ...entry,
        accessedAt: now.toISOString(),
        hitCount: entry.hitCount + 1,
      },
      now,
    );
  }

  /** Every readable entry, most recently accessed first. */
  async list(): Promise<DocumentCacheEntry[]> {
    const entries = await this.listAll();
    return entries
      .flatMap((candidate) =>
        candidate.entry === undefined ? [] : [candidate.entry],
      )
      .sort((left, right) => (left.accessedAt < right.accessedAt ? 1 : -1));
  }

  /**
   * Drop entries that aged out, that exceed the count budget, or that push the
   * total size over its budget. Overflow removal is least-recently-used first,
   * so a hot conversion survives a burst of one-off ones.
   */
  async prune(now: Date = new Date()): Promise<CachePruneReport> {
    const all = await this.listAll();
    let unreadable = 0;
    let expired = 0;
    let overflowed = 0;
    const fresh: { entry: DocumentCacheEntry; file: string }[] = [];
    for (const candidate of all) {
      if (candidate.entry === undefined) {
        unreadable += 1;
        await rm(candidate.file, { force: true }).catch(() => undefined);
        continue;
      }
      const age = now.getTime() - Date.parse(candidate.entry.accessedAt);
      if (Number.isFinite(age) && age > this.maxAgeMs) {
        expired += 1;
        await rm(candidate.file, { force: true }).catch(() => undefined);
        continue;
      }
      fresh.push({ entry: candidate.entry, file: candidate.file });
    }
    fresh.sort((left, right) =>
      left.entry.accessedAt < right.entry.accessedAt ? -1 : 1,
    );
    let count = fresh.length;
    let bytes = fresh.reduce((total, item) => total + item.entry.bytes, 0);
    for (const item of fresh) {
      if (count <= this.maxEntries && bytes <= this.maxBytes) break;
      await rm(item.file, { force: true }).catch(() => undefined);
      count -= 1;
      bytes -= item.entry.bytes;
      overflowed += 1;
    }
    return { expired, overflowed, unreadable };
  }

  private async listAll(): Promise<
    { entry: DocumentCacheEntry | undefined; file: string }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.dir());
    } catch {
      return [];
    }
    const found: { entry: DocumentCacheEntry | undefined; file: string }[] = [];
    for (const name of names) {
      if (!name.endsWith(ENTRY_FILE_SUFFIX)) continue;
      const file = path.join(this.dir(), name);
      const details = await stat(file).catch(() => undefined);
      if (details === undefined || !details.isFile()) continue;
      const raw = await readFile(file, "utf8").catch(() => undefined);
      if (raw === undefined) {
        found.push({ entry: undefined, file });
        continue;
      }
      try {
        const entry = JSON.parse(raw) as DocumentCacheEntry;
        found.push({
          entry:
            entry.version === CACHE_ENTRY_VERSION &&
            typeof entry.key === "string"
              ? entry
              : undefined,
          file,
        });
      } catch {
        found.push({ entry: undefined, file });
      }
    }
    return found;
  }
}
