// Unit tests for the dependency-free helpers in src/core.ts.

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MODE,
  ancestryCrumbs,
  augmentConfinedArgv,
  listDirectoryLevel,
  renderSelectedPolicyText,
} from "../src/core.js";

test("renderSelectedPolicyText names the roots only when present", () => {
  // Workspace selected: named first, then the other selected directories.
  const empty = renderSelectedPolicyText({
    mode: MODE,
    workspaceRoot: "/ws",
    extraWritableRoots: ["/ws"],
  });
  assert.match(empty, /selected-workspace-write/);
  assert.match(empty, /"\/ws"/);
  assert.doesNotMatch(empty, /selected directories/);
  const withRoots = renderSelectedPolicyText({
    mode: MODE,
    workspaceRoot: "/ws",
    extraWritableRoots: ["/ws", "/data", "/notes"],
  });
  assert.match(withRoots, /\[\"\/data\",\"\/notes\"\]/);
  // Workspace excluded: it is not in the writable list and is read-only.
  const offEmpty = renderSelectedPolicyText({
    mode: MODE,
    workspaceRoot: "/ws",
    extraWritableRoots: [],
  });
  assert.match(offEmpty, /read-only/);
  const offWithRoots = renderSelectedPolicyText({
    mode: MODE,
    workspaceRoot: "/ws",
    extraWritableRoots: ["/data"],
  });
  assert.match(offWithRoots, /\[\"\/data\"\]/);
  assert.match(offWithRoots, /read-only/);
  assert.doesNotMatch(offWithRoots, /under the session workspace/);
});

test("augmentConfinedArgv splices grants per dialect", () => {
  const base = {
    enforcement: "full",
    denialSignatures: ["read-only file system"],
    runnerFailureRules: [],
  };

  const bwrap = augmentConfinedArgv(
    {
      ...base,
      argv: [
        "bwrap",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        "/ws",
        "/ws",
        "--",
        "bash",
        "-c",
        "x",
      ],
    },
    ["/data", "/notes"],
  );
  assert.deepEqual(bwrap.argv, [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--bind",
    "/ws",
    "/ws",
    "--bind",
    "/data",
    "/data",
    "--bind",
    "/notes",
    "/notes",
    "--",
    "bash",
    "-c",
    "x",
  ]);

  const landlock = augmentConfinedArgv(
    {
      ...base,
      argv: [
        "/opt/landlock-run",
        "--ro",
        "/",
        "--rw",
        "/dev/null",
        "--rw",
        "/tmp",
        "--rw",
        "/ws",
        "--",
        "bash",
        "-c",
        "x",
      ],
    },
    ["/data"],
  );
  assert.deepEqual(landlock.argv, [
    "/opt/landlock-run",
    "--ro",
    "/",
    "--rw",
    "/dev/null",
    "--rw",
    "/tmp",
    "--rw",
    "/ws",
    "--rw",
    "/data",
    "--",
    "bash",
    "-c",
    "x",
  ]);

  const seatbelt = augmentConfinedArgv(
    {
      ...base,
      argv: [
        "sandbox-exec",
        "-p",
        '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))(allow file-write* (subpath "/tmp") (subpath "/ws"))',
        "--",
        "bash",
        "-c",
        "x",
      ],
    },
    ["/data"],
  );
  assert.equal(
    seatbelt.argv[2],
    '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))(allow file-write* (subpath "/data") (subpath "/tmp") (subpath "/ws"))',
  );

  // Unknown dialect (custom runnerCommand / Windows ACL): unchanged, fail closed.
  const unknown = augmentConfinedArgv(
    { ...base, argv: ["my-runner", "--flag", "--", "bash", "-c", "x"] },
    ["/data"],
  );
  assert.deepEqual(unknown.argv, [
    "my-runner",
    "--flag",
    "--",
    "bash",
    "-c",
    "x",
  ]);

  // No separator: grants append at the end.
  const noSep = augmentConfinedArgv(
    { ...base, argv: ["bwrap", "--ro-bind", "/", "/"] },
    ["/data"],
  );
  assert.deepEqual(noSep.argv, [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--bind",
    "/data",
    "/data",
  ]);

  // Workspace excluded (read-only base): temp areas + extra roots granted.
  const offBwrap = augmentConfinedArgv(
    {
      ...base,
      argv: ["bwrap", "--ro-bind", "/", "/", "--", "bash", "-c", "x"],
    },
    ["/data"],
    ["/tmp"],
  );
  assert.deepEqual(offBwrap.argv, [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--tmpfs",
    "/tmp",
    "--bind",
    "/data",
    "/data",
    "--",
    "bash",
    "-c",
    "x",
  ]);
  const offLandlock = augmentConfinedArgv(
    {
      ...base,
      argv: [
        "/opt/landlock-run",
        "--ro",
        "/",
        "--rw",
        "/dev/null",
        "--",
        "bash",
        "-c",
        "x",
      ],
    },
    ["/data"],
    ["/tmp"],
  );
  assert.deepEqual(offLandlock.argv, [
    "/opt/landlock-run",
    "--ro",
    "/",
    "--rw",
    "/dev/null",
    "--rw",
    "/tmp",
    "--rw",
    "/data",
    "--",
    "bash",
    "-c",
    "x",
  ]);
  const offSeatbelt = augmentConfinedArgv(
    {
      ...base,
      argv: [
        "sandbox-exec",
        "-p",
        '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))',
        "--",
        "bash",
        "-c",
        "x",
      ],
    },
    ["/data"],
    ["/tmp"],
  );
  assert.equal(
    offSeatbelt.argv[2],
    '(version 1)(allow default)(deny file-write*)(allow file-write* (subpath "/tmp") (subpath "/data") (literal "/dev/null"))',
  );
});

test("ancestryCrumbs walks to the filesystem root", () => {
  const crumbs = ancestryCrumbs("/ws/sub/deep");
  assert.equal(crumbs.length >= 4, true);
  assert.equal(crumbs[crumbs.length - 1].path, "/ws/sub/deep");
  assert.equal(crumbs[0].path, "/");
});

test("listDirectoryLevel lists one level with truncation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wss-list-"));
  try {
    mkdirSync(join(dir, "b-dir"));
    mkdirSync(join(dir, "a-dir"));
    mkdirSync(join(dir, ".hidden"));
    writeFileSync(join(dir, "file.txt"), "x");
    const listing = await listDirectoryLevel(dir, { maxEntries: 100 });
    assert.equal(listing.path, dir);
    assert.deepEqual(
      listing.entries.map((entry) => entry.name),
      [".hidden", "a-dir", "b-dir"],
    );
    assert.equal(listing.truncated, false);
    assert.ok(listing.crumbs.length >= 1);
    const truncated = await listDirectoryLevel(dir, { maxEntries: 1 });
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.entries.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
