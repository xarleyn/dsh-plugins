import {
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ResolvedKvPersistConfig } from "../config.js";
import { parseManifest } from "./manifest.js";
import type { SnapshotManifest } from "./manifest.js";
import { snapshotGenerations } from "./naming.js";

type Policy = NonNullable<ResolvedKvPersistConfig["retention"]>;
export interface RetentionReport {
  mode: Policy["mode"];
  maxBytes: number;
  beforeBytes: number;
  remainingBytes: number;
  projectedBytes: number;
  unattributedBytes: number;
  candidates: string[];
  evicted: string[];
}

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function physicalDirectory(path: string) {
  const physical = await realpath(path);
  if (
    relative(resolve(path), physical) !== "" ||
    !(await lstat(physical)).isDirectory()
  ) {
    throw Error("retention requires a physical directory without symlinks");
  }
  return physical;
}

interface Group {
  digest: string;
  manifest: SnapshotManifest;
  pending: boolean;
  saved: number;
  files: string[];
  bytes: number;
}

/** The caller holds the same lease used for inference, restore, save and purge. */
export async function collectSnapshots(
  metadataRoot: string,
  instance: string,
  policy: Policy,
  protectedSessions: ReadonlySet<string>,
): Promise<RetentionReport> {
  const binaryRoot = await physicalDirectory(policy.sharedDirectory);
  const metadata = join(metadataRoot, "instances", instance, "sessions");
  const groups = new Map<string, Group>();
  let manifests: string[] = [];
  try {
    manifests = await readdir(await physicalDirectory(metadata));
  } catch (error) {
    if (!absent(error)) throw error;
  }
  // A published manifest supersedes any older cleanup receipt for that digest.
  for (const name of manifests) {
    const match = /^([a-f0-9]{64})\.(json|gc)$/.exec(name);
    if (!match) continue;
    const digest = match[1]!;
    const pending = match[2] === "gc";
    if (pending && groups.has(digest)) continue;
    const path = join(metadata, name);
    if (!(await lstat(path)).isFile())
      throw Error("unexpected manifest file type");
    const manifest = parseManifest(JSON.parse(await readFile(path, "utf8")));
    const names = snapshotGenerations(manifest);
    if (
      manifest.serverInstanceKey !== instance ||
      names[0] !== digest + ".bin" ||
      !names.includes(manifest.snapshotFilename)
    )
      throw Error("retention manifest identity mismatch");
    const lastSaved =
      manifest.lastSavedAt ??
      (manifest.state === "ready" ? manifest.updatedAt : null);
    groups.set(digest, {
      digest,
      pending,
      manifest,
      saved: lastSaved ? Date.parse(lastSaved) : Infinity,
      files: [],
      bytes: 0,
    });
  }

  const report: RetentionReport = {
    mode: policy.mode,
    maxBytes: policy.maxBytes,
    beforeBytes: 0,
    remainingBytes: 0,
    projectedBytes: 0,
    unattributedBytes: 0,
    candidates: [],
    evicted: [],
  };
  for (const entry of await readdir(binaryRoot, { withFileTypes: true })) {
    const match = /^([a-f0-9]{64})(?:\.b)?\.bin$/.exec(entry.name);
    if (!match) continue;
    const group = groups.get(match[1]!);
    if (!entry.isFile()) {
      if (group) throw Error("unexpected snapshot file type");
      continue;
    }
    const file = join(binaryRoot, entry.name);
    const info = await lstat(file);
    if (!info.isFile()) throw Error("snapshot file type changed");
    if (!group) {
      report.unattributedBytes += info.size;
      continue;
    }
    group.files.push(entry.name);
    group.bytes += info.size;
    report.beforeBytes += info.size;
  }
  report.remainingBytes = report.beforeBytes;
  let projected = report.beforeBytes;
  const sorted = [...groups.values()].sort(
    (a, b) =>
      Number(b.pending) - Number(a.pending) ||
      a.saved - b.saved ||
      a.digest.localeCompare(b.digest),
  );
  for (const group of sorted) {
    if (protectedSessions.has(group.manifest.sessionId)) continue;
    if (
      !group.pending &&
      (projected <= policy.maxBytes ||
        !Number.isFinite(group.saved) ||
        !group.files.includes(group.manifest.snapshotFilename))
    )
      continue;
    report.candidates.push(group.digest);
    projected -= group.bytes;
    if (policy.mode === "dry-run") continue;
    const receipt = join(metadata, group.digest + ".gc");
    // Rename first so a crash can only leave unreachable files with a retry receipt.
    if (!group.pending)
      await rename(join(metadata, group.digest + ".json"), receipt);
    for (const name of group.files) await unlink(join(binaryRoot, name));
    await unlink(receipt);
    report.remainingBytes -= group.bytes;
    report.evicted.push(group.digest);
  }
  report.projectedBytes = projected;
  return report;
}
