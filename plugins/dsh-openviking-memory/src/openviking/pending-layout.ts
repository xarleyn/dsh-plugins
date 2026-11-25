/**
 * Derived from OpenViking's @openviking/dsh-memory-plugin.
 * Original project: https://github.com/volcengine/OpenViking
 * Licensed under the Apache License, Version 2.0.
 *
 * Modified by the @yadsh/dsh-openviking-memory project.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Dirent } from "node:fs";

const messages = "messages";
const commits = "commits";

export function commitBucket(sessionId: string): string {
  return join(commits, createHash("sha256").update(sessionId).digest("hex"));
}

export function entryBucket(
  type: string,
  sessionId: string,
  key: string,
): string {
  return type === "commitSession"
    ? commitBucket(sessionId)
    : join(messages, key);
}

export async function names(dir: string): Promise<string[]> {
  return (await children(dir)).map((entry) => entry.name);
}

async function children(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function queueFile(name: string): boolean {
  return name.endsWith(".json") || name.endsWith(".processing");
}

/** Flat files written by earlier versions stay replayable through their original paths.
 * Modern writes only modify the two subtrees, so their growing backlog never
 * invalidates this small index of old top-level commit and dedup identities. */
interface LegacyIndex {
  keys: Set<string>;
  commits: Map<string, string[]>;
  owners: Map<string, string | null>;
}
let legacy:
  { dir: string; stamp: string; index: Promise<LegacyIndex> } | undefined;

export async function legacyIndex(dir: string): Promise<LegacyIndex> {
  const info = await stat(dir, { bigint: true });
  const stamp = [info.ino, info.birthtimeNs, info.mtimeNs].join(":");
  if (legacy?.dir === dir && legacy.stamp === stamp) return legacy.index;
  const index = readLegacyIndex(
    dir,
    legacy?.dir === dir ? legacy.index : undefined,
  );
  legacy = { dir, stamp, index };
  try {
    return await index;
  } catch (error) {
    if (legacy?.index === index) legacy = undefined;
    throw error;
  }
}

async function readLegacyIndex(
  dir: string,
  previous?: Promise<LegacyIndex>,
): Promise<LegacyIndex> {
  const known = (await previous?.catch(() => undefined))?.owners;
  const result: LegacyIndex = {
    keys: new Set(),
    commits: new Map(),
    owners: new Map(),
  };
  for (const filename of await names(dir)) {
    if (!queueFile(filename)) continue;
    const key = /^([a-f0-9]{64})_/.exec(filename)?.[1];
    if (key) result.keys.add(key);
    const identity = key ?? filename;
    try {
      let owner = known?.get(identity);
      if (owner === undefined) {
        const entry = JSON.parse(await readFile(join(dir, filename), "utf8"));
        owner =
          entry?.type === "commitSession" && typeof entry.sessionId === "string"
            ? (entry.sessionId as string)
            : null;
      }
      result.owners.set(identity, owner);
      if (owner !== null) {
        const files = result.commits.get(owner) ?? [];
        files.push(filename);
        result.commits.set(owner, files);
      }
    } catch {
      // A concurrent claim or a malformed legacy entry is skipped just as on replay.
    }
  }
  return result;
}

/** Keep the legacy directory and both new buckets in the same ordered replay. */
export async function allQueueFiles(dir: string): Promise<string[]> {
  const root = await children(dir);
  const result = root
    .filter((entry) => entry.isFile() && queueFile(entry.name))
    .map((entry) => entry.name);
  for (const group of root) {
    if (
      !group.isDirectory() ||
      (group.name !== messages && group.name !== commits)
    )
      continue;
    for (const bucket of await children(join(dir, group.name))) {
      if (!bucket.isDirectory() || !/^[a-f0-9]{64}$/.test(bucket.name))
        continue;
      const relative = join(group.name, bucket.name);
      for (const item of await children(join(dir, relative))) {
        if (item.isFile() && queueFile(item.name))
          result.push(join(relative, item.name));
      }
    }
  }
  return result;
}
