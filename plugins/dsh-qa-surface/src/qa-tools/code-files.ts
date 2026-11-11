import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  selectCodeSource,
  type CodeSource,
  type CodeSourcesCatalog,
} from "@yadsh/dsh-plugin-kit/code-sources";
import { pathIsInside } from "../user-workspace.js";

export interface CodeExecution {
  readonly agent?: {
    readonly session?: {
      readonly id?: unknown;
      readonly header?: { readonly cwd?: unknown };
    };
  };
}

export interface CodeFilesOptions {
  readonly codeSources?:
    ((exec?: CodeExecution) => CodeSourcesCatalog) | undefined;
  readonly codeReadRoots?: (() => readonly string[]) | undefined;
}

export interface CodeScope {
  readonly source: CodeSource;
  readonly root: string;
}

/** Selection and authorization are separate, including after following root links. */
export async function codeScope(
  options: CodeFilesOptions,
  exec: CodeExecution,
  requested?: unknown,
): Promise<CodeScope> {
  const source = selectCodeSource(
    options.codeSources?.(exec) ?? { defaultSource: "", entries: [] },
    requested,
  );
  if (source === undefined)
    throw new Error(
      "No code sources are configured; ask the operator to configure codeSources.",
    );
  const cwd = exec.agent?.session?.header?.cwd;
  if (typeof cwd !== "string" || !isAbsolute(cwd))
    throw new Error("Code tools require a session working directory.");
  const roots = [cwd, ...(options.codeReadRoots?.() ?? [])];
  const canonicalRoots = await Promise.all(
    roots.map((root) => realpath(root).catch(() => undefined)),
  );
  const root = await realpath(source.path).catch(() => undefined);
  if (root === undefined || !(await lstat(root)).isDirectory())
    throw new Error(
      "Selected code source is unavailable; no other source was substituted.",
    );
  if (
    !roots.some((allowed) =>
      pathIsInside(resolve(source.path), resolve(allowed)),
    ) ||
    !canonicalRoots.some(
      (allowed) => allowed !== undefined && pathIsInside(root, allowed),
    )
  ) {
    throw new Error(
      "Selected code source is outside the session and sharedReadOnlyRoots.",
    );
  }
  return { source, root };
}

/** Refuse traversal and every nested link, including links that stay in-tree. */
async function target(scope: CodeScope, input: unknown): Promise<string> {
  if (
    typeof input !== "string" ||
    input.includes("\0") ||
    isAbsolute(input) ||
    /(^|[/\\])\.\.([/\\]|$)/u.test(input)
  ) {
    throw new Error("Code path must be source-relative without traversal.");
  }
  const absolute = resolve(scope.root, input);
  if (!pathIsInside(absolute, scope.root))
    throw new Error("Code path escapes the selected source.");
  let cursor = scope.root;
  for (const part of relative(scope.root, absolute)
    .split(/[/\\]/u)
    .filter(Boolean)) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Code paths through symbolic links are refused.");
  }
  if (!pathIsInside(await realpath(absolute), scope.root))
    throw new Error("Code path escapes the selected source.");
  return absolute;
}

const FILE_BYTES = 1024 * 1024;
const RESULT_BYTES = 32 * 1024;
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".nx",
  ".cache",
  "bin",
  "obj",
  "dist",
  "lib",
]);

async function textLines(file: string): Promise<string[]> {
  if (!(await lstat(file)).isFile())
    throw new Error("Code file must be a regular file.");
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > FILE_BYTES)
      throw new Error(
        "Code file is not a regular text file within the 1 MiB limit.",
      );
    const bytes = Buffer.alloc(Math.min(info.size + 1, FILE_BYTES + 1));
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, null);
      if (read.bytesRead === 0) break;
      used += read.bytesRead;
    }
    if (used > info.size || bytes.subarray(0, used).includes(0))
      throw new Error("Code file changed while reading or is binary.");
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(0, used))
      .split(/\r?\n/u);
  } finally {
    await handle.close();
  }
}

export function boundedInteger(
  value: unknown,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1)
    throw new Error("Expected a positive line number or limit.");
  return Math.min(Math.floor(value), max);
}

/** Read a bounded window, with the selected identity on every result. */
export async function readCode(
  scope: CodeScope,
  args: { path?: unknown; from?: unknown; lines?: unknown },
) {
  const absolutePath = await target(scope, args.path);
  const lines = await textLines(absolutePath);
  const from = boundedInteger(args.from, 1, Number.MAX_SAFE_INTEGER);
  const count = boundedInteger(args.lines, 120, 400);
  const window: string[] = [];
  let used = 0;
  for (const line of lines.slice(from - 1, from - 1 + count)) {
    const size = Buffer.byteLength(line) + 1;
    if (used + size > RESULT_BYTES) break;
    used += size;
    window.push(line);
  }
  return {
    source: scope.source.id,
    label: scope.source.label,
    root: scope.root,
    path: relative(scope.root, absolutePath).replaceAll("\\", "/"),
    absolutePath,
    from,
    to: from + window.length - 1,
    totalLines: lines.length,
    text: window.join("\n"),
    truncated: from > 1 || from + window.length <= lines.length,
  };
}

/** Literal search in one tree; entry, file, content, time and output budgets are fixed. */
export async function searchCode(
  scope: CodeScope,
  args: { query?: unknown; path?: unknown; limit?: unknown },
) {
  if (
    typeof args.query !== "string" ||
    args.query.trim() === "" ||
    args.query.length > 512
  )
    throw new Error(
      "query must be a non-empty literal of at most 512 characters.",
    );
  const query = args.query.toLowerCase();
  const start = await target(scope, args.path ?? "");
  const limit = boundedInteger(args.limit, 20, 100);
  const hits: { path: string; line: number; text: string }[] = [];
  const pending = [start];
  let entries = 0,
    filesScanned = 0,
    skipped = 0,
    used = 0,
    contentBytes = 0,
    truncated = false;
  const deadline = Date.now() + 3000;
  outer: while (pending.length > 0) {
    if (
      ++entries > 10_000 ||
      filesScanned >= 1000 ||
      contentBytes >= 8 * FILE_BYTES ||
      Date.now() > deadline
    ) {
      truncated = true;
      break;
    }
    const next = pending.pop()!;
    const info = await lstat(next).catch(() => undefined);
    if (info === undefined || info.isSymbolicLink()) {
      skipped++;
      continue;
    }
    if (info.isDirectory()) {
      const directory = await opendir(next);
      for await (const child of directory) {
        if (++entries > 10_000 || Date.now() > deadline) {
          truncated = true;
          break outer;
        }
        if (
          child.isSymbolicLink() ||
          (child.isDirectory() && SKIP_DIRECTORIES.has(child.name))
        ) {
          skipped++;
          continue;
        }
        pending.push(resolve(next, child.name));
      }
      continue;
    }
    if (!info.isFile() || info.size > FILE_BYTES) {
      skipped++;
      continue;
    }
    if (contentBytes + info.size > 8 * FILE_BYTES) {
      truncated = true;
      break;
    }
    filesScanned++;
    contentBytes += info.size;
    const checked = await target(scope, relative(scope.root, next));
    const lines = await textLines(checked).catch(() => undefined);
    if (lines === undefined) {
      skipped++;
      continue;
    }
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(query)) continue;
      const hit = {
        path: relative(scope.root, checked).replaceAll("\\", "/"),
        line: index + 1,
        text: line.slice(0, 500),
      };
      const size = Buffer.byteLength(JSON.stringify(hit));
      if (hits.length >= limit || used + size > RESULT_BYTES) {
        truncated = true;
        break outer;
      }
      used += size;
      hits.push(hit);
    }
  }
  return {
    source: scope.source.id,
    label: scope.source.label,
    root: scope.root,
    query: args.query,
    hits,
    filesScanned,
    skipped,
    truncated,
  };
}
