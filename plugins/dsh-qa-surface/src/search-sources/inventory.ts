import { randomUUID } from "node:crypto";
import { opendir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { openArchivePath } from "./archive-path.js";
import {
  fold,
  inventoryPolicy,
  type EntryKind,
  type InventoryPolicy,
} from "./inventory-policy.js";
import { segments, type ArchiveOperation } from "./protocol.js";

export interface InventoryEntry {
  path: string;
  kind: EntryKind;
}
interface Inventory {
  version: number;
  snapshot: string;
  indexedAt: string;
  directory: string;
  device: string;
  inode: string;
  policy: string;
  partial: boolean;
  entries: InventoryEntry[];
}
const maxBytes = 64 * 1024 * 1024;
export const unavailableEntry = (err: unknown) =>
  ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "ELOOP", "ESTALE"].includes(
    (err as NodeJS.ErrnoException)?.code ?? "",
  );
export async function buildInventory(
  root: string,
  directory: string,
  policy: InventoryPolicy,
  signal: AbortSignal,
): Promise<Inventory> {
  const top = await openArchivePath(root, directory, "", "directory", signal);
  const id = await top.stat({ bigint: true }).finally(() => top.close());
  const entries: InventoryEntry[] = [];
  const todo = [""];
  let bytes = 0;
  let partial = false;
  while (todo.length) {
    signal.throwIfAborted();
    const path = todo.pop()!;
    try {
      const folder = await openArchivePath(
        root,
        directory,
        path,
        "directory",
        signal,
        policy,
      );
      try {
        const stream = await opendir("/proc/self/fd/" + folder.fd);
        for await (const item of stream) {
          signal.throwIfAborted();
          const kind = item.isDirectory()
            ? "directory"
            : item.isFile()
              ? "file"
              : undefined;
          if (!kind || !policy.permits(item.name, kind)) continue;
          const child = path ? path + "/" + item.name : item.name;
          try {
            segments(child);
          } catch {
            partial = true;
            continue;
          }
          bytes += Buffer.byteLength(JSON.stringify({ path: child, kind })) + 1;
          if (entries.length >= 250000 || bytes > maxBytes - 2048)
            throw new Error("Archive inventory limit exceeded.");
          entries.push({ path: child, kind });
          if (kind === "directory") todo.push(child);
        }
      } finally {
        await folder.close();
      }
    } catch (err) {
      if (!path || !unavailableEntry(err)) throw err;
      partial = true;
    }
  }
  return {
    version: 1,
    snapshot: randomUUID(),
    indexedAt: new Date().toISOString(),
    directory,
    device: String(id.dev),
    inode: String(id.ino),
    policy: policy.digest,
    partial,
    entries,
  };
}

function words(name: string): string[] {
  return fold(name.replaceAll("№", " ")).match(/[\p{L}]+|[\p{N}]+/gu) ?? [];
}
function projectIds(name: string): string[] {
  return Array.from(
    fold(name.replaceAll("№", " ")).matchAll(
      /(?:^|[^\p{L}\p{N}])(?:id|ид)\s*-?\s*(\d+)\b/gu,
    ),
    (match) => match[1]!,
  );
}
function score(entry: InventoryEntry, terms: string[], requestedIds: string[]) {
  const names = entry.path.split("/");
  const leaf = words(names.at(-1)!);
  const all = words(entry.path);
  // A parent can group multiple deals. A more specific ID on a child narrows that group.
  const idGroups = names.map(projectIds).filter((ids) => ids.length);
  const nearestIds = idGroups.at(-1);
  let rank = 0;
  for (const term of terms) {
    if (
      nearestIds &&
      !nearestIds.includes(term) &&
      (requestedIds.includes(term) ||
        idGroups.some((group) => group.includes(term)))
    )
      return -1;
    const matches = (w: string) =>
      w === term ||
      (term.length >= 3 && !/^\d+$/u.test(term) && w.startsWith(term));
    if (!all.some(matches)) return -1;
    if (leaf.includes(term)) rank += 8;
    else if (leaf.some(matches)) rank += 5;
  }
  return rank;
}
export async function browseInventory(
  root: string,
  op: ArchiveOperation,
  signal: AbortSignal,
  policy: InventoryPolicy,
  file: string,
) {
  if (
    (op.depth !== undefined &&
      (!Number.isInteger(op.depth) || op.depth < 1 || op.depth > 4)) ||
    (op.kind !== undefined && op.kind !== "directory" && op.kind !== "file")
  )
    throw new Error("Invalid inventory options.");
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes)
    throw new Error("Invalid inventory file.");
  const inventory = JSON.parse(
    await readFile(file, { encoding: "utf8", signal }),
  ) as Inventory;
  const top = await openArchivePath(
    root,
    op.directory,
    "",
    "directory",
    signal,
  );
  const id = await top.stat({ bigint: true }).finally(() => top.close());
  if (
    inventory.version !== 1 ||
    inventory.policy !== policy.digest ||
    inventory.directory !== op.directory ||
    inventory.inode !== String(id.ino) ||
    inventory.device !== String(id.dev) ||
    (op.snapshot !== undefined && op.snapshot !== inventory.snapshot)
  )
    throw new Error("Inventory needs refreshing.");
  const terms = [
    ...new Set(words(op.query).filter((w) => w !== "id" && w !== "ид")),
  ];
  const requestedIds = projectIds(op.query);
  if (op.action === "find" && !terms.length)
    throw new Error("Search terms required.");
  const prefix = op.path ? op.path + "/" : "";
  const rows = [];
  for (const e of inventory.entries) {
    if (!e.path.startsWith(prefix) || (op.kind && e.kind !== op.kind)) continue;
    const depth = e.path.slice(prefix.length).split("/").length;
    if (op.action === "tree" && depth > (op.depth ?? 2)) continue;
    const rank = op.action === "find" ? score(e, terms, requestedIds) : 0;
    if (rank >= 0) rows.push({ entry: e, rank, depth });
  }
  rows.sort(
    (a, b) =>
      b.rank - a.rank ||
      a.depth - b.depth ||
      (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0),
  );
  const entries: InventoryEntry[] = [];
  let cursor = op.offset;
  while (cursor < rows.length && entries.length < 30) {
    signal.throwIfAborted();
    const e = rows[cursor++]!.entry;
    try {
      const live = await openArchivePath(
        root,
        op.directory,
        e.path,
        e.kind,
        signal,
        policy,
      );
      const valid = await live
        .stat()
        .then((s) => (e.kind === "directory" ? s.isDirectory() : s.isFile()))
        .finally(() => live.close());
      if (valid) entries.push(e);
    } catch (err) {
      if (!unavailableEntry(err)) throw err;
    }
  }
  return {
    entries,
    nextOffset: cursor < rows.length ? cursor : null,
    snapshot: inventory.snapshot,
    indexedAt: inventory.indexedAt,
    partial: inventory.partial,
  };
}

// Operator-driven, names-only scan. The reader never schedules background walks.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2];
  if (
    process.platform !== "linux" ||
    !directory ||
    !process.env.QA_ARCHIVE_POLICY
  )
    throw new Error("Missing archive configuration.");
  const result = await buildInventory(
    "/archive",
    directory,
    inventoryPolicy(process.env.QA_ARCHIVE_POLICY),
    AbortSignal.timeout(15 * 60 * 1000),
  );
  process.stdout.write(JSON.stringify(result));
}
