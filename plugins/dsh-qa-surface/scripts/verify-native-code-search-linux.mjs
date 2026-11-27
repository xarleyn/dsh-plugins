import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { createCodeSearchTool } from "../lib/qa-tools/code-tools.js";

const binary = process.env.QA_CODE_SEARCH_BIN;
assert.ok(binary, "set QA_CODE_SEARCH_BIN to the built Linux helper");
assert.equal(process.platform, "linux");

test("code_search parity and bounded Rust execution in Linux", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "code-search-proof-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  t.after(() => {
    process.env.QA_CODE_SEARCH_BIN = binary;
  });
  const left = join(fixture, "release");
  const right = join(fixture, "preview");
  const work = join(fixture, "work");
  await Promise.all([
    mkdir(join(left, "node_modules"), { recursive: true }),
    mkdir(join(left, "cases"), { recursive: true }),
    mkdir(join(left, "bulk"), { recursive: true }),
    mkdir(join(left, "content-budget"), { recursive: true }),
    mkdir(right),
    mkdir(work),
  ]);
  await Promise.all([
    writeFile(join(right, "other.txt"), "outside-only-marker"),
    writeFile(join(left, "node_modules", "ignored.txt"), "outside-only-marker"),
    symlink(right, join(left, "linked")),
    writeFile(
      join(left, "cases", "lines.txt"),
      "\uFEFFПРИМЕР 🚚\r\nпример\r\nтекст".padEnd(40),
    ),
    writeFile(
      join(left, "cases", "long.txt"),
      "x".repeat(499) + "🚚" + " outside",
    ),
    writeFile(join(left, "cases", "binary"), Buffer.from([0, 97])),
    writeFile(join(left, "cases", "invalid"), Buffer.from([0xff])),
    writeFile(join(left, "cases", "large.txt"), "a".repeat(1024 * 1024 + 1)),
  ]);
  execFileSync("/usr/bin/mkfifo", [join(left, "cases", "pipe")]);
  const catalog = {
    defaultSource: "release",
    entries: [
      { id: "release", label: "Release", path: left },
      { id: "preview", label: "Preview", path: right },
    ],
  };
  const codeTool = createCodeSearchTool({
    codeSources: () => catalog,
    codeReadRoots: () => [left],
  });
  const execute = (
    mode,
    args,
    signal = new globalThis.AbortController().signal,
  ) => {
    if (mode === "rust") process.env.QA_CODE_SEARCH_BIN = binary;
    else delete process.env.QA_CODE_SEARCH_BIN;
    return codeTool.execute(args, {
      signal,
      agent: { session: { header: { cwd: work } } },
    });
  };

  for (const args of [
    { query: "пример", path: "cases" },
    { query: "ПРИМЕР", limit: 1, path: "cases/lines.txt" },
    { query: "outside", path: "cases/long.txt" },
    { query: "\ud83d", path: "cases/long.txt" },
    { query: "outside-only-marker" },
  ]) {
    const original = await execute("js", args);
    assert.deepEqual(await execute("rust", args), original);
  }
  await assert.rejects(
    execute("rust", { source: "preview", query: "outside" }),
    /outside/u,
  );
  await assert.rejects(
    execute("rust", { query: "outside", path: "linked/other.txt" }),
    /links/u,
  );
  await assert.rejects(
    execute("rust", { query: "outside", path: "../preview/other.txt" }),
    /traversal/u,
  );

  const fullPreview = "Marker " + "a".repeat(493);
  await writeFile(
    join(left, "cases", "preview.txt"),
    (fullPreview + "\n").repeat(100),
  );
  const previewArgs = {
    query: "marker",
    path: "cases/preview.txt",
    limit: 100,
  };
  const preview = await execute("js", previewArgs);
  assert.equal(preview.truncated, true);
  assert.ok(preview.hits.length < 100);
  assert.deepEqual(await execute("rust", previewArgs), preview);
  const megabyte = Buffer.alloc(1024 * 1024, 97);
  await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      writeFile(join(left, "content-budget", index + ".txt"), megabyte),
    ),
  );
  const budgetArgs = { query: "missing", path: "content-budget" };
  const budget = await execute("js", budgetArgs);
  assert.equal(budget.filesScanned, 8);
  assert.equal(budget.truncated, true);
  assert.deepEqual(await execute("rust", budgetArgs), budget);

  const standIn = join(fixture, "slow-helper");
  await writeFile(standIn, "#!/bin/sh\nexec /bin/sleep 30\n");
  await chmod(standIn, 0o700);
  process.env.QA_CODE_SEARCH_BIN = standIn;
  await assert.rejects(
    codeTool.execute(
      { query: "пример", path: "cases" },
      {
        signal: globalThis.AbortSignal.timeout(70),
        agent: { session: { header: { cwd: work } } },
      },
    ),
    { name: "TimeoutError" },
  );

  // A sparse matching workload forces both engines to visit every file.
  for (let dir = 0; dir < 19; dir++) {
    const directory = join(left, "bulk", String(dir));
    await mkdir(directory);
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(
          join(directory, String(index) + ".txt"),
          "Synthetic line without a match.\n".repeat(32) +
            (index === 49 ? "unique-marker\n" : ""),
        ),
      ),
    );
  }
  const args = { query: "unique-marker", path: "bulk", limit: 100 };
  const expected = await execute("js", args);
  assert.equal(expected.filesScanned, 950);
  assert.equal(expected.hits.length, 19);
  assert.equal(expected.truncated, false);
  assert.deepEqual(await execute("rust", args), expected);
  const measurements = { js: [], rust: [] };
  for (let trial = 0; trial < 9; trial++) {
    for (const mode of trial % 2 ? ["rust", "js"] : ["js", "rust"]) {
      const started = performance.now();
      const answer = await execute(mode, args);
      measurements[mode].push(performance.now() - started);
      assert.deepEqual(answer, expected);
    }
  }
  for (const times of Object.values(measurements)) times.sort((a, b) => a - b);
  t.diagnostic(
    JSON.stringify({
      files: expected.filesScanned,
      hits: expected.hits.length,
      trials: 9,
      javascriptP50Ms: measurements.js[4],
      rustP50Ms: measurements.rust[4],
    }),
  );
});
