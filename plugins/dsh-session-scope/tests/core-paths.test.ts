// Unit tests for the dependency-free helpers in src/core.ts.

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  canonicalPath,
  isLexicallyUnder,
  isPathUnder,
  normalizeRoots,
  tempWritableRoots,
  workspaceWritableRoots,
} from "../src/core.js";

test("normalizeRoots validates, canonicalizes, dedupes, sorts", () => {
  const canonical = (path: string) => (path === "/a" ? "/resolved-a" : path);
  assert.deepEqual(normalizeRoots(["/b", "/a", "/a"], canonical), [
    "/b",
    "/resolved-a",
  ]);
  assert.deepEqual(normalizeRoots([], canonical), []);
  assert.throws(() => normalizeRoots("nope"), /expects a JSON array/);
  assert.throws(
    () => normalizeRoots(["/ok", "relative"]),
    /not an absolute directory path/,
  );
  assert.throws(
    () => normalizeRoots(["/ok", 42]),
    /not an absolute directory path/,
  );
  assert.throws(
    () => normalizeRoots(["/ok", ""]),
    /not an absolute directory path/,
  );
  const many: string[] = [];
  for (let index = 0; index < 200; index += 1) many.push(`/dir-${index}`);
  assert.throws(() => normalizeRoots(many), /at most 128/);
});

test("isLexicallyUnder covers equality and separator-aware descendants", () => {
  const root = `${sep}ws`;
  assert.equal(isLexicallyUnder(join(root, "a"), root), true);
  assert.equal(isLexicallyUnder(root, root), true);
  assert.equal(isLexicallyUnder(`${root}-other`, root), false);
  assert.equal(isLexicallyUnder(join(root, "a"), join(root, "sub")), false);
  if (process.platform === "win32") {
    assert.equal(isLexicallyUnder("C:\\ws\\a", "C:\\ws", false), true);
    assert.equal(isLexicallyUnder("C:\\ws-other", "C:\\ws", false), false);
  }
});

test("isPathUnder falls back to filesystem identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wss-test-"));
  try {
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const target = join(sub, "file.txt");
    writeFileSync(target, "x");
    assert.equal(await isPathUnder(target, dir), true);
    assert.equal(
      await isPathUnder(join(dir, "sub", "missing", "deep"), dir),
      true,
    );
    assert.equal(
      await isPathUnder(join(dir, "nonexistent"), join(dir, "nope")),
      false,
    );
    // Windows-alias style: identical identity via a different spelling.
    const fakeStat = async () => ({ dev: 7n, ino: 42n });
    assert.equal(
      await isPathUnder("/alias/sub", "/real", false, fakeStat),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspaceWritableRoots contains the workspace and the temp areas", () => {
  const roots = workspaceWritableRoots("/ws");
  assert.ok(roots.includes(canonicalPath("/ws")));
  assert.ok(roots.includes(canonicalPath("/tmp")));
  assert.ok(roots.includes(canonicalPath(tmpdir())));
  assert.equal(new Set(roots).size, roots.length);
});

test("tempWritableRoots excludes the workspace", () => {
  const roots = tempWritableRoots();
  assert.ok(roots.includes(canonicalPath("/tmp")));
  assert.ok(roots.includes(canonicalPath(tmpdir())));
  assert.ok(!roots.includes(canonicalPath("/ws")));
  assert.equal(new Set(roots).size, roots.length);
});
