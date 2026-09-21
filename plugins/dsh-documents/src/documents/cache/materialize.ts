/**
 * Turning a cache hit into an artifact.
 *
 * A hit is never a shortcut around the artifact store: the cached bytes are
 * copied into a fresh bundle, verified against the hash the entry recorded, and
 * only then reported as a created file. So a caller that receives a result
 * cannot tell a hit from a run — same bundle shape, same `sha256`, same
 * manifest — except for the `cache` record that says where the bytes came from.
 */

import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { ArtifactStore } from "../artifacts/store.js";
import { sha256OfFile } from "../artifacts/store.js";
import type { DocumentWarning } from "../types.js";
import type { DocumentCacheEntry, DocumentCacheOutput } from "./key.js";

/** One restored output, ready to become a `DocumentFileResult`. */
export interface MaterializedOutput {
  readonly format: DocumentCacheOutput["format"];
  readonly path: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
}

export interface MaterializedHit {
  readonly outputs: readonly MaterializedOutput[];
  readonly backends: DocumentCacheEntry["backends"];
  readonly warnings: readonly DocumentWarning[];
  /** Facts the stored result carried beside its files (pages, assets). */
  readonly extras: Readonly<Record<string, unknown>>;
  /** Bundle the bytes came from, for the manifest's provenance record. */
  readonly sourceArtifactId: string;
}

/**
 * Copy the entry's files into `artifactId`'s bundle.
 *
 * Returns `undefined` when anything about the entry no longer holds: a source
 * artifact was removed by retention, a file was tampered with, or the bytes no
 * longer match the recorded hash. Every one of those is a miss — the caller
 * runs the backend again — because serving unverified bytes as a conversion
 * result would be exactly the kind of silent wrongness the cache must not add.
 */
export async function materializeCacheHit(options: {
  readonly store: ArtifactStore;
  readonly artifactId: string;
  readonly entry: DocumentCacheEntry;
  readonly outputName: (output: DocumentCacheOutput) => string;
}): Promise<MaterializedHit | undefined> {
  const { store, artifactId, entry } = options;
  const restored: MaterializedOutput[] = [];
  try {
    for (const output of entry.outputs) {
      const source = store.path(
        path.join(output.artifactId, output.outputName),
      );
      const details = await stat(source).catch(() => undefined);
      if (details === undefined || !details.isFile()) return undefined;
      if (details.size !== output.size) return undefined;
      const bytes = await readFile(source);
      if (bytes.length !== output.size) return undefined;
      const destination = path.join(artifactId, options.outputName(output));
      const written = await store.write(destination, bytes);
      if (written.sha256 !== output.sha256) return undefined;
      restored.push({
        format: output.format,
        path: written.path,
        mediaType: output.mediaType,
        size: written.size,
        sha256: written.sha256,
      });
    }
  } catch {
    return undefined;
  }
  if (restored.length === 0) return undefined;
  return {
    outputs: restored,
    backends: entry.backends,
    warnings: entry.warnings as readonly DocumentWarning[],
    extras: entry.extras ?? {},
    sourceArtifactId: entry.outputs[0]?.artifactId ?? entry.key,
  };
}

/** Remove a bundle whose materialization failed halfway. */
export async function discardBundle(
  store: ArtifactStore,
  artifactId: string,
): Promise<void> {
  await rm(store.artifactDir(artifactId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
}

/**
 * Hash a bundle's file exactly as the cache would record it. Used when storing
 * a fresh run, so the entry's fingerprint and the file on disk are measured the
 * same way.
 */
export async function fingerprintOutput(filePath: string): Promise<{
  readonly size: number;
  readonly sha256: string;
}> {
  const details = await stat(filePath);
  return { size: details.size, sha256: await sha256OfFile(filePath) };
}
