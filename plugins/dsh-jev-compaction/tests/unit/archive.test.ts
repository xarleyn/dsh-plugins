/**
 * The local content-addressed archive: addressing, atomic writes, hash-verified
 * reads and retention (result-shaping SPEC §22-§24).
 */

import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectArchive } from "../../src/archive/gc.js";
import {
  contentRef,
  isArchiveRef,
  refHex,
  stableStringify,
} from "../../src/archive/hash.js";
import {
  ARCHIVE_HOME_SEGMENTS,
  LocalResultArchive,
  MAX_ARCHIVE_ENTRY_BYTES,
  resolveArchiveRoot,
} from "../../src/archive/local.js";
import { shortRef, type ArchivedToolResult } from "../../src/archive/types.js";
import { resolveJevCompactionConfig } from "../../src/config.js";

let root: string;
let archive: LocalResultArchive;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jev-archive-"));
  archive = new LocalResultArchive(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(
  text: string,
  overrides: Partial<ArchivedToolResult> = {},
): ArchivedToolResult {
  const content = [{ type: "text", text }];
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    callId: "call-1",
    toolName: "bash",
    content,
    contentHash: contentRef(content),
    charCount: text.length,
    ...overrides,
  };
}

describe("content addressing", () => {
  it("is stable under key order and ref-sensitive to content", () => {
    expect(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(
      stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }),
    );
    const one = contentRef([{ type: "text", text: "a" }]);
    const two = contentRef([{ type: "text", text: "b" }]);
    expect(one).not.toBe(two);
    expect(isArchiveRef(one)).toBe(true);
    expect(isArchiveRef("sha256:xyz")).toBe(false);
    expect(refHex(one)).toHaveLength(64);
    expect(shortRef(one)).toMatch(/^sha256:[0-9a-f]{12}$/u);
  });

  it("resolves the default root under the harness home", () => {
    const config = resolveJevCompactionConfig({});
    const resolved = resolveArchiveRoot(config);
    expect(resolved.endsWith(join(...ARCHIVE_HOME_SEGMENTS))).toBe(true);
    const configured = resolveArchiveRoot(
      resolveJevCompactionConfig({
        archive: { rootPath: join(root, "custom") },
      }),
    );
    expect(configured).toBe(join(root, "custom"));
  });
});

describe("LocalResultArchive", () => {
  it("stores an entry under its hash and reads it back", async () => {
    const ref = await archive.put(entry("hello world"));
    expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await readdir(root)).toEqual([`sha256-${refHex(ref)}.json`]);
    const stored = await archive.get(ref);
    expect(stored?.toolName).toBe("bash");
    expect(stored?.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("deduplicates identical payloads", async () => {
    const first = await archive.put(entry("same output"));
    const second = await archive.put(entry("same output"));
    expect(second).toBe(first);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("keeps different payloads apart", async () => {
    await archive.put(entry("one"));
    await archive.put(entry("two"));
    expect(await readdir(root)).toHaveLength(2);
  });

  it("reports a tampered entry as missing instead of returning it", async () => {
    const ref = await archive.put(entry("original"));
    const path = join(root, `sha256-${refHex(ref)}.json`);
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as ArchivedToolResult;
    await writeFile(
      path,
      JSON.stringify({
        ...parsed,
        content: [{ type: "text", text: "edited" }],
      }),
      "utf8",
    );
    expect(await archive.get(ref)).toBeNull();
  });

  it("returns null for an unknown or malformed entry", async () => {
    expect(await archive.get(`sha256:${"0".repeat(64)}`)).toBeNull();
    await writeFile(
      join(root, `sha256-${"1".repeat(64)}.json`),
      "not json",
      "utf8",
    );
    expect(await archive.get(`sha256:${"1".repeat(64)}`)).toBeNull();
  });

  it("refuses an entry over the size limit instead of writing a partial file", async () => {
    const huge = entry("x".repeat(MAX_ARCHIVE_ENTRY_BYTES + 1));
    await expect(archive.put(huge)).rejects.toThrow(/exceeds/u);
    expect(await readdir(root)).toHaveLength(0);
  });

  it("leaves no temporary file behind", async () => {
    await archive.put(entry("clean"));
    expect((await readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("lists entries oldest first and deletes by reference", async () => {
    const older = await archive.put(entry("older"));
    await utimes(
      join(root, `sha256-${refHex(older)}.json`),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const newer = await archive.put(entry("newer"));
    const listed = await archive.list();
    expect(listed.map((item) => item.ref)).toEqual([older, newer]);
    await archive.delete(newer);
    expect(await archive.get(newer)).toBeNull();
  });
});

describe("collectArchive", () => {
  it("does nothing when both limits are unset", async () => {
    await archive.put(entry("kept"));
    const report = await collectArchive(
      archive,
      resolveJevCompactionConfig({
        archive: { retentionDays: 0, maxBytes: 0 },
      }),
    );
    expect(report.deleted).toBe(0);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("drops entries past the retention window and keeps the rest", async () => {
    const stale = await archive.put(entry("stale"));
    const fresh = await archive.put(entry("fresh"));
    await utimes(
      join(root, `sha256-${refHex(stale)}.json`),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const report = await collectArchive(
      archive,
      resolveJevCompactionConfig({
        archive: { retentionDays: 7, maxBytes: 0 },
      }),
    );
    expect(report.deleted).toBe(1);
    expect(await archive.get(stale)).toBeNull();
    expect(await archive.get(fresh)).not.toBeNull();
  });

  it("enforces the size ceiling oldest-first", async () => {
    const first = await archive.put(entry("x".repeat(400)));
    await utimes(
      join(root, `sha256-${refHex(first)}.json`),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const second = await archive.put(entry("y".repeat(400)));
    const total = (await archive.list()).reduce(
      (sum, item) => sum + item.bytes,
      0,
    );
    const report = await collectArchive(
      archive,
      resolveJevCompactionConfig({
        // Just under the combined size: exactly one entry has to go.
        archive: { retentionDays: 0, maxBytes: total - 1 },
      }),
    );
    expect(report.deleted).toBe(1);
    expect(await archive.get(first)).toBeNull();
    // The newest entry is the last to go.
    expect(await archive.get(second)).not.toBeNull();
  });

  it("is inert on a missing archive directory", async () => {
    const missing = new LocalResultArchive(join(root, "does-not-exist"));
    const report = await collectArchive(
      missing,
      resolveJevCompactionConfig({ archive: { retentionDays: 1 } }),
    );
    expect(report).toEqual({ deleted: 0, bytesFreed: 0, kept: 0, errors: 0 });
  });
});
