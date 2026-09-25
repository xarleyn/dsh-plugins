// repo-config.test.mjs — the repository's own configuration files, checked the
// way the rest of the tooling is: so that a config cannot rot silently.
//
// `.git-blame-ignore-revs` needs that most, because it holds commit hashes: any
// history rewrite (a rebase, a squashed re-push, a branch recreated from a
// patch) turns it into a file that still looks correct and does nothing. The
// checks below keep it honest — every hash resolves on this branch, every entry
// is a formatting-only commit by the repository's own `style(...)` convention,
// and CONTRIBUTING.md still tells a reader how to switch the list on, since a
// file nobody enables is a file nobody has.
//
// The inventory behind these checks is the answer to "which repository configs
// are missing": `.editorconfig`, `.gitattributes`, `.gitignore`, `.nvmrc`,
// `.prettierrc`, `.prettierignore`, `eslint.config.js`, `nx.json`,
// `pnpm-workspace.yaml`, `tsconfig.base.json` and both CI workflows are present
// and current; the blame list was the gap.
//
// `nx.json` needs the same treatment for a different reason: its inputs decide
// what a cached task is keyed on, and a `lint` target keyed on the project
// alone replays a stale verdict forever after anyone edits the root ESLint
// config. The last two cases read that config and then prove the behaviour in a
// throwaway workspace assembled from it, so neither the mistake nor its fix can
// hide inside nx's own resolution.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const BLAME_FILE = ".git-blame-ignore-revs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTRIBUTING = fileURLToPath(
  new URL("../CONTRIBUTING.md", import.meta.url),
);
const NX_JSON = JSON.parse(read("nx.json"));
const nxCli = path.join(ROOT, "node_modules", "nx", "dist", "bin", "nx.js");

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
}

/** The revisions the blame list declares, in file order. */
function listedRevs() {
  return read(BLAME_FILE)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

test("the blame list carries full commit hashes, each exactly once", () => {
  const revs = listedRevs();
  assert.ok(revs.length > 0, `${BLAME_FILE} lists no revision at all`);
  for (const rev of revs) {
    assert.match(rev, /^[0-9a-f]{40}$/u, `${rev} is not a full commit hash`);
  }
  assert.equal(new Set(revs).size, revs.length, `${BLAME_FILE} repeats a hash`);
});

test("every listed revision still resolves on this branch", () => {
  for (const rev of listedRevs()) {
    const exists = git("cat-file", "-e", `${rev}^{commit}`);
    assert.equal(exists.status, 0, `${rev} does not resolve: ${exists.output}`);
    const reachable = git("merge-base", "--is-ancestor", rev, "HEAD");
    assert.equal(
      reachable.status,
      0,
      `${rev} is not an ancestor of HEAD; a rewritten history must not leave it in ${BLAME_FILE}`,
    );
  }
});

test("every listed revision is a formatting-only commit", () => {
  for (const rev of listedRevs()) {
    const subject = git("show", "--format=%s", "-s", rev).output;
    assert.match(
      subject,
      /^style\(/u,
      `${rev} is '${subject}'; only a \`style(...)\` commit belongs in ${BLAME_FILE}`,
    );
  }
});

test("CONTRIBUTING.md tells a reader how to enable the blame list", () => {
  const text = readFileSync(CONTRIBUTING, "utf8");
  assert.match(
    text,
    /blame\.ignoreRevsFile/u,
    "the enabling command is undocumented",
  );
  assert.match(
    text,
    /\.git-blame-ignore-revs/u,
    "the file itself is undocumented",
  );
});

/**
 * The workspace-root files `lint` is keyed on, read out of nx.json the way nx
 * reads them: named inputs are followed recursively, negations and globs are
 * ignored, and what is left is the list of root configs a cached verdict depends
 * on. Empty means the cache cannot see the config eslint actually loads.
 */
function lintRootConfigs() {
  const namedInputs = NX_JSON.namedInputs ?? {};
  const files = new Set();
  const queue = [...(NX_JSON.targetDefaults?.lint?.inputs ?? [])];
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const raw of namedInputs[name] ?? []) {
      if (typeof raw !== "string" || raw.startsWith("!")) continue;
      if (namedInputs[raw]) {
        queue.push(raw);
        continue;
      }
      if (!raw.startsWith("{workspaceRoot}/")) continue;
      const relative = raw.slice("{workspaceRoot}/".length);
      if (!relative.includes("*")) files.add(relative);
    }
  }
  return [...files];
}

test("the lint cache is keyed on the root configs eslint actually loads", () => {
  const files = lintRootConfigs();
  assert.ok(
    files.includes("eslint.config.js"),
    `a cached lint verdict must depend on the root ESLint config; nx.json keys it on ${JSON.stringify(files)} instead`,
  );
  for (const file of files) {
    assert.ok(
      existsSync(path.join(ROOT, file)),
      `nx.json names ${file} as a lint input, but no such file exists`,
    );
  }
});

function runNx(cwd, args) {
  const result = spawnSync(process.execPath, [nxCli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, CI: "true", NX_DAEMON: "false" },
  });
  assert.equal(
    result.status,
    0,
    `nx ${args.join(" ")} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test("editing a root lint config invalidates a cached lint run", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-lint-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rootConfigs = lintRootConfigs();

  writeJson(path.join(root, "package.json"), {
    name: "lint-cache-fixture",
    private: true,
    packageManager: "pnpm@10.4.1",
    workspaces: ["packages/*"],
  });
  // The fixture's nx.json is the repository's, cut down to what decides the
  // lint cache key — so this case fails exactly when nx.json regresses.
  writeJson(path.join(root, "nx.json"), {
    namedInputs: NX_JSON.namedInputs,
    targetDefaults: { lint: NX_JSON.targetDefaults.lint },
    analytics: false,
  });
  writeFile(path.join(root, ".gitignore"), ".nx/\nnode_modules/\ncount.txt\n");
  for (const file of rootConfigs)
    writeFile(path.join(root, file), "export default [];\n");
  writeJson(path.join(root, "packages/demo/package.json"), {
    name: "@demo/pkg",
    version: "1.0.0",
    type: "module",
    scripts: { lint: "node count-runs.mjs" },
  });
  writeFile(
    path.join(root, "packages/demo/count-runs.mjs"),
    "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
      "const file = new URL('../../count.txt', import.meta.url);\n" +
      "const runs = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;\n" +
      "writeFileSync(file, String(runs + 1));\n" +
      "console.log('linted');\n",
  );
  writeFile(
    path.join(root, "packages/demo/src/index.js"),
    "export const x = 1;\n",
  );
  symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "junction",
  );

  const runs = () => Number(readFileSync(path.join(root, "count.txt"), "utf8"));

  runNx(root, ["run", "@demo/pkg:lint"]);
  assert.equal(runs(), 1, "the first lint must run");

  const replayed = runNx(root, ["run", "@demo/pkg:lint"]);
  assert.match(replayed.stdout, /read the output from the cache/u);
  assert.equal(
    runs(),
    1,
    "an untouched workspace must replay the cached verdict",
  );

  for (const file of rootConfigs) {
    appendFileSync(path.join(root, file), "// a rule change\n");
  }
  const invalidated = runNx(root, ["run", "@demo/pkg:lint"]);
  assert.doesNotMatch(
    invalidated.stdout,
    /read the output from the cache/u,
    "editing the root config the linter reads must not replay the cached verdict",
  );
  assert.equal(runs(), 2, "the lint task re-ran after a root config edit");
});
