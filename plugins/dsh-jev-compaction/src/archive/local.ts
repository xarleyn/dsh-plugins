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
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

import type { ResolvedJevCompactionConfig } from "../config.js";
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

/** The local filesystem archive. */
export class LocalResultArchive implements OriginalResultArchive {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(
    entry: ArchivedToolResult,
    _options?: { readonly signal?: AbortSignal },
  ): Promise<ArchiveRef> {
    const serialized = JSON.stringify(entry);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(
        `archive entry of ${bytes} bytes exceeds the ${MAX_ARCHIVE_ENTRY_BYTES}-byte limit`,
      );
    }
    const path = entryPath(this.root, entry.contentHash);
    if (await this.exists(path)) return entry.contentHash;
    await mkdir(dirname(path), { recursive: true });
    // Atomic: a reader never sees a half-written entry under its final name.
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, serialized, "utf8");
    await rename(temporary, path);
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
      if (contentRef(parsed.content) !== parsed.contentHash) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async delete(ref: ArchiveRef): Promise<void> {
    await unlink(entryPath(this.root, ref)).catch(() => undefined);
  }

  /** Names of every stored entry, oldest first by file mtime. */
  async list(): Promise<
    { ref: string; path: string; bytes: number; mtimeMs: number }[]
  > {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch {
      return [];
    }
    const entries: {
      ref: string;
      path: string;
      bytes: number;
      mtimeMs: number;
    }[] = [];
    for (const name of names) {
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

  private async exists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }
}
