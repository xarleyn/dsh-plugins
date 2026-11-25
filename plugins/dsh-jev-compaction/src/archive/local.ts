/**
 * Local content-addressed archive (result-shaping SPEC §23-§24).
 *
 * Layout, one JSON file per distinct payload:
 *
 *   <root>/sha256-<hex>.json
 *
 * Writes are atomic (temp file + rename) and bounded in size; reads verify the
 * hash, so a truncated or edited entry is reported as absent rather than
 * returned as truth. Nothing here decides *whether* to archive — that is the
 * pipeline's policy — and nothing here ever blocks on a large directory scan:
 * retention runs through the GC module, lazily.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

import type { ResolvedJevCompactionConfig } from "../config/index.js";
import { contentRef, refHex } from "./hash.js";
import type {
  ArchiveRef,
  ArchivedToolResult,
  OriginalResultArchive,
} from "./types.js";

/** Default subdirectory under the harness home (SPEC §23). */
export const ARCHIVE_HOME_SEGMENTS: readonly string[] = Object.freeze([
  "data",
  "dsh-jev-compaction",
  "originals",
]);

/** Largest entry the archive will store; bigger originals are not archived. */
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;

/** Resolve the archive root: explicit config first, harness home otherwise. */
export function resolveArchiveRoot(
  config: ResolvedJevCompactionConfig,
): string {
  const configured = config.archive.rootPath.trim();
  if (configured.length > 0) return configured;
  return dshHomePath(...ARCHIVE_HOME_SEGMENTS);
}

/** One stored entry file. */
function entryPath(root: string, ref: ArchiveRef): string {
  return join(root, `sha256-${refHex(ref)}.json`);
}

interface ArchiveFile {
  ref: string;
  path: string;
  bytes: number;
  mtimeMs: number;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** The local filesystem archive. */
export class LocalResultArchive implements OriginalResultArchive {
  readonly root: string;
  private static readonly pending = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = root;
  }

  async put(
    entry: ArchivedToolResult,
    options?: { readonly signal?: AbortSignal; readonly maxBytes?: number },
  ): Promise<ArchiveRef> {
    options?.signal?.throwIfAborted();
    const serialized = JSON.stringify(entry);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const limit =
      options?.maxBytes !== undefined && options.maxBytes > 0
        ? Math.min(options.maxBytes, MAX_ARCHIVE_ENTRY_BYTES)
        : MAX_ARCHIVE_ENTRY_BYTES;
    // An entry that would evict itself cannot back a recoverable result.
    if (bytes > limit) {
      throw new Error(
        `archive entry of ${bytes} bytes exceeds the ${limit}-byte limit`,
      );
    }
    await this.mutate(entry.contentHash, async () => {
      options?.signal?.throwIfAborted();
      const path = entryPath(this.root, entry.contentHash);
      const existing = await this.statEntry(path);
      if (
        existing?.isFile() &&
        existing.size <= limit &&
        (await this.get(entry.contentHash)) !== null
      ) {
        // A new reference renews the retention window. Make the new mtime
        // distinguishable even if it lands in the same millisecond as a scan.
        const now = new Date(
          Math.max(Date.now(), Math.floor(existing.mtimeMs) + 1),
        );
        await utimes(path, now, now);
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, {
          flag: "wx",
          signal: options?.signal,
        });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error: unknown) => {
          if (!missing(error)) throw error;
        });
      }
    });
    return entry.contentHash;
  }

  async get(ref: ArchiveRef): Promise<ArchivedToolResult | null> {
    try {
      const raw = await readFile(entryPath(this.root, ref), "utf8");
      const parsed = JSON.parse(raw) as ArchivedToolResult;
      if (parsed.version !== 1 || typeof parsed.content !== "object") {
        return null;
      }
      // Integrity: an entry that does not hash back to its own name is not
      // evidence of anything, so report it as missing.
      if (parsed.contentHash !== ref || contentRef(parsed.content) !== ref)
        return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async delete(ref: ArchiveRef): Promise<void> {
    await this.mutate(ref, () =>
      unlink(entryPath(this.root, ref)).catch((error: unknown) => {
        if (!missing(error)) throw error;
      }),
    );
  }

  /** Do not remove an original that was referenced again after the GC scan. */
  deleteUnchanged(
    entry: ArchiveFile,
    signal?: AbortSignal,
  ): Promise<"deleted" | "changed" | "missing"> {
    return this.mutate(entry.ref, async () => {
      const path = entryPath(this.root, entry.ref);
      const current = await this.statEntry(path);
      if (!current) return "missing";
      if (
        signal?.aborted ||
        current.mtimeMs !== entry.mtimeMs ||
        current.size !== entry.bytes
      )
        return "changed";
      try {
        await unlink(path);
        return "deleted";
      } catch (error) {
        if (missing(error)) return "missing";
        throw error;
      }
    });
  }

  /** Names of every stored entry, oldest first by file mtime. */
  async list(signal?: AbortSignal): Promise<ArchiveFile[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const entries: ArchiveFile[] = [];
    for (const name of names) {
      if (signal?.aborted) break;
      const match = /^sha256-([0-9a-f]{64})\.json$/u.exec(name);
      if (match === null) continue;
      const path = join(this.root, name);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        entries.push({
          ref: `sha256:${match[1]}`,
          path,
          bytes: info.size,
          mtimeMs: info.mtimeMs,
        });
      } catch {
        // A file that vanished between readdir and stat is simply gone.
      }
    }
    entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
    return entries;
  }

  private async statEntry(path: string) {
    try {
      return await stat(path);
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  /** Writers and GC for a given path also coordinate across overlapping mounts. */
  private mutate<T>(ref: ArchiveRef, change: () => Promise<T>): Promise<T> {
    const path = resolve(entryPath(this.root, ref));
    const pending = LocalResultArchive.pending;
    const next = (pending.get(path) ?? Promise.resolve()).then(change);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    pending.set(path, settled);
    return next.finally(() => {
      if (pending.get(path) === settled) pending.delete(path);
    });
  }
}
