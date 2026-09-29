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
// `nx.json` needs the same treatment for a different reason: its `inputs` decide
// what a cached task is keyed on and its `outputs` decide what that verdict
// carries. A `lint` target keyed on the project alone replays a stale verdict
// forever after anyone edits the root ESLint config; a `build` target that
// declares no outputs replays a verdict whose artifacts were never stored. The
// last two cases read that config and then prove the behaviour in a throwaway
// workspace assembled from it, so neither the mistake nor its fix can hide
// inside nx's own resolution.
//
// SPEC.md is read for the opposite reason. It ranks itself below the code it
// describes, so a line of it that disagrees with `nx.json` is wrong rather than
// authoritative — but three of its blocks are copied verbatim from configuration,
// and a copy is the one form of prose that fails silently: the section keeps
// reading as shipped configuration while the file behind it has moved. Each copy
// is therefore cut from the section its heading names and not from the first
// fenced body below it, because an unbounded slice lets the next section answer
// for this one; the copies in §14, §17 and §22 are then compared to `nx.json`,
// to the `prepare` job of `ci.yml` and to the root `package.json`. That is what
// turns them from a document that was aligned once into one that cannot drift
// unnoticed. §20 states one fact about the repository rather than its
// configuration — that no `name@version` tag is left to read — so the census
// behind it is re-run here. It asks the remotes the checkout points at, because
// the local ref store records what this clone has seen rather than what the
// repository holds; and a census that no remote answered, or that one of them
// stayed silent in, reports itself skipped — a tag set nobody measured, or
// measured only in part, is not a tag set that came back empty.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

/**
 * Discard a tree an `nx` child may still hold a handle on: Windows refuses the
 * removal of a directory whose files are still open with `EPERM`, and a teardown
 * error would fail a case whose assertions all passed. The removal retries the
 * transient lock codes and, if the handle outlives the retries, leaves the
 * directory behind in the OS temp folder.
 */
function removeTree(target, { maxRetries = 10, retryDelay = 300 } = {}) {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries, retryDelay });
  } catch {
    // Callers that need the tree gone assert that themselves.
  }
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

/**
 * An `nx` started on a machine that is already running the rest of the suite can
 * fail before it ran any task: the project graph blames a worker or a socket that
 * was not scheduled in time, and the command reports a break the fixture never
 * had. A failed attempt therefore gets one retry. What is never retried is what
 * the cases assert — a stale verdict or a missing artifact still fails the case,
 * on the second attempt at the latest.
 */
function spawnNx(cwd, args) {
  return spawnSync(process.execPath, [nxCli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    env: {
      ...process.env,
      CI: "true",
      NX_DAEMON: "false",
      // The fixture workspaces need one inferred plugin, the package-json
      // project graph. Loaded in a worker it has to be spawned, connected and
      // told to load within ten seconds, which a machine running the rest of the
      // suite alongside cannot promise; in-process it has no such budget.
      NX_ISOLATE_PLUGINS: "false",
    },
  });
}

function runNx(cwd, args) {
  let result = spawnNx(cwd, args);
  if (result.status !== 0) {
    result = spawnNx(cwd, args);
  }
  assert.equal(
    result.status,
    0,
    `nx ${args.join(" ")} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test("editing a root lint config invalidates a cached lint run", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-lint-cache-"));
  t.after(() => removeTree(root));
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

/**
 * The second `nx.json` contract a cached task has to satisfy: `inputs` says what
 * a verdict is keyed on, `outputs` says what the verdict carries. A `build`
 * keyed without `outputs` stores the verdict alone — the lane reports
 * `Successfully ran target build for 31 projects`, `lib/` stays missing, and the
 * next consumer fails on `TS2307: Cannot find module '@yadsh/dsh-plugin-log'`
 * in code nobody touched. The fixture builds the repository's own
 * `targetDefaults.build`, so it goes red the moment `outputs` leaves nx.json or
 * stops naming the directory the compilers actually emit into.
 */
test("a cached build restores its artifacts, not only its verdict", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-build-cache-"));
  t.after(() => removeTree(root));

  writeJson(path.join(root, "package.json"), {
    name: "build-cache-fixture",
    private: true,
    packageManager: "pnpm@10.4.1",
    workspaces: ["packages/*"],
  });
  writeJson(path.join(root, "nx.json"), {
    namedInputs: NX_JSON.namedInputs,
    targetDefaults: { build: NX_JSON.targetDefaults.build },
    analytics: false,
  });
  writeFile(path.join(root, ".gitignore"), ".nx/\nnode_modules/\ncount.txt\n");
  writeJson(path.join(root, "packages/demo/package.json"), {
    name: "@demo/built",
    version: "1.0.0",
    type: "module",
    scripts: { build: "node make-lib.mjs" },
  });
  writeFile(
    path.join(root, "packages/demo/make-lib.mjs"),
    "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';\n" +
      "const count = new URL('../../count.txt', import.meta.url);\n" +
      "const runs = existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0;\n" +
      "writeFileSync(count, String(runs + 1));\n" +
      "mkdirSync(new URL('lib/', import.meta.url), { recursive: true });\n" +
      "writeFileSync(new URL('lib/index.js', import.meta.url), 'export const built = 1;\\n');\n" +
      "console.log('built');\n",
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

  const artifact = path.join(root, "packages", "demo", "lib", "index.js");
  const runs = () => Number(readFileSync(path.join(root, "count.txt"), "utf8"));

  runNx(root, ["run", "@demo/built:build"]);
  assert.ok(existsSync(artifact), "the cold build must leave lib/index.js");
  assert.equal(runs(), 1, "the cold build must run once");

  // The cold build's child can still hold a handle on `lib/`, so this removal
  // retries longer than a teardown does: the scenario is only the scenario once
  // the artifacts are really gone, and a stalled machine must not read as a
  // regression.
  removeTree(path.join(root, "packages", "demo", "lib"), {
    maxRetries: 40,
    retryDelay: 500,
  });
  assert.ok(
    !existsSync(artifact),
    "the scenario starts from a tree whose artifacts are gone",
  );
  const replayed = runNx(root, ["run", "@demo/built:build"]);
  assert.match(replayed.stdout, /read the output from the cache/u);
  assert.equal(
    runs(),
    1,
    "an untouched workspace must replay the cached build, not compile again",
  );
  assert.ok(
    existsSync(artifact),
    "a cache hit must restore lib/ — replaying only the verdict leaves the tree without the artifacts later tasks import",
  );
});

// The coverage contract of `pnpm test:coverage` lives in one preset that every
// package measures through, so nothing in the build proves it is still wired up:
// a package can lose its `test:coverage` script, or keep a hand-copied setup
// that drifts from its own `test`, and every command stays green. These checks
// hold the three things the number depends on — the preset's shape, the script
// of each package that runs vitest over a `src` tree, and the merge semantics a
// package must not fight. A package with no TypeScript under `src` is the one
// exception: the preset measures `src/**`, so there is no number for it to
// produce, and the case is named on every run rather than left out silently.
const PRESET = "packages/config/vitest/vitest.config.ts";
const WORKSPACE_GROUPS = ["plugins", "packages", "tooling/generators"];

/** Every workspace package directory that carries a manifest. */
function workspacePackages() {
  const found = [];
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = new URL(`../${group}/`, import.meta.url);
    if (!existsSync(fileURLToPath(groupDir))) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${group}/${entry.name}`;
      const manifest = new URL(`../${dir}/package.json`, import.meta.url);
      if (!existsSync(fileURLToPath(manifest))) continue;
      found.push({ dir, scripts: readJson(manifest).scripts ?? {} });
    }
  }
  return found;
}

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

/** The commands a package runs before it hands over to vitest, if any. */
function setupOf(script) {
  const at = script.indexOf("vitest run");
  return at === -1 ? null : script.slice(0, at);
}

/** Whether the package ships the tree the preset measures: TypeScript under `src`. */
function hasMeasuredSource(dir) {
  const root = path.join(ROOT, dir, "src");
  if (!existsSync(root)) return false;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else if (/\.[cm]?tsx?$/.test(entry.name)) return true;
    }
  }
  return false;
}

test("the shared Vitest preset carries the coverage defaults", async () => {
  const { baseConfig } = await import(new URL(`../${PRESET}`, import.meta.url));
  const coverage = baseConfig.test?.coverage ?? {};
  assert.equal(coverage.provider, "v8", "coverage must stay V8-instrumented");
  assert.ok(
    (coverage.reporter ?? []).includes("json-summary"),
    "the machine-readable summary is what makes the number comparable",
  );
  assert.ok(
    coverage.include?.length > 0 &&
      coverage.include.every((glob) => glob.startsWith("src/")),
    "every package measures its own src tree",
  );
  assert.equal(
    coverage.reportOnFailure,
    true,
    "a red run still has to report its number",
  );
  assert.equal(
    coverage.thresholds,
    undefined,
    "a floor turns the measurement into a gate that competes with the per-file size budget",
  );
});

test("every package that runs vitest declares the matching test:coverage", () => {
  const vitestPackages = workspacePackages().filter(
    (pkg) => setupOf(pkg.scripts.test ?? "") !== null,
  );
  assert.ok(vitestPackages.length > 0, "no package runs vitest at all");
  const measured = vitestPackages.filter((pkg) => hasMeasuredSource(pkg.dir));
  for (const { dir } of vitestPackages) {
    if (hasMeasuredSource(dir)) continue;
    console.log(
      `not measured: ${dir} — no TypeScript under src, so the preset has no tree to instrument`,
    );
  }
  assert.ok(
    measured.length > 0,
    "no package has a src tree, so test:coverage measures nothing anywhere",
  );
  for (const { dir, scripts } of measured) {
    const coverage = scripts["test:coverage"];
    assert.ok(
      coverage,
      `${dir} runs vitest over its src tree but declares no \`test:coverage\``,
    );
    assert.ok(
      coverage.startsWith(`${setupOf(scripts.test)}vitest run --coverage`),
      `${dir} \`test:coverage\` must run the same setup as \`test\` and then pass --coverage, got: ${coverage}`,
    );
  }
});

test("no package narrows coverage by re-declaring include", () => {
  for (const { dir } of workspacePackages()) {
    const file = new URL(`../${dir}/vitest.config.ts`, import.meta.url);
    if (!existsSync(fileURLToPath(file))) continue;
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /coverage:\s*\{[^{}]*\binclude\s*:/su,
      `${dir}/vitest.config.ts re-declares coverage.include; mergeConfig concatenates arrays, so it widens the measured tree instead of narrowing it — use coverage.exclude`,
    );
  }
});

const SPEC_MD = read("SPEC.md");

const FENCES = {
  bash: /^```bash\n(?<body>[\s\S]*?)\n```$/mu,
  json: /^```json\n(?<body>[\s\S]*?)\n```$/mu,
};

/**
 * The body of one section of SPEC.md: the lines between its heading and the next
 * heading of the file. The heading is matched rather than the block so a renamed
 * or deleted section fails by name instead of leaving the case silently asserting
 * nothing, and the slice ends there because one that runs to the end of the file
 * lets whichever fenced block comes next answer for the section under test — the
 * drift these cases exist to catch.
 */
function specSection(heading) {
  const marker = `\n## ${heading}\n`;
  const at = SPEC_MD.indexOf(marker);
  assert.notEqual(at, -1, `SPEC.md no longer has a "## ${heading}" section`);
  const body = SPEC_MD.slice(at + marker.length);
  const boundary = /^#{2,6} /mu.exec(body);
  return boundary ? body.slice(0, boundary.index) : body;
}

/** The first fenced `language` block of a section of SPEC.md, as text. */
function specFence(heading, language) {
  const block = FENCES[language].exec(specSection(heading));
  assert.ok(
    block,
    `the "## ${heading}" section of SPEC.md no longer carries a \`\`\`${language} block`,
  );
  return block.groups.body;
}

/** The first fenced `json` block of a section of SPEC.md, parsed. */
function specBlock(heading) {
  return JSON.parse(specFence(heading, "json"));
}

test("SPEC.md reproduces the release configuration nx.json ships", () => {
  const { release } = specBlock("14. Nx release configuration");
  assert.deepEqual(
    release,
    NX_JSON.release,
    "SPEC.md §14 quotes `release` from nx.json; editing one without the other leaves a Draft describing a configuration nobody runs",
  );
});

/**
 * The commands one job of `ci.yml` runs, in order: every step with a single-line
 * `run:`, so a block scalar — the step that selects projects rather than gating
 * them — is not read as a gate. A job ends where the next two-space key begins.
 */
function jobCommands(workflow, name) {
  const marker = `  ${name}:`;
  const at = workflow.indexOf(marker);
  assert.notEqual(at, -1, `ci.yml no longer has a "${name}" job`);
  const body = workflow.slice(at + marker.length);
  const end = /^ {2}\S/mu.exec(body);
  const commands = [];
  for (const line of body.slice(0, end ? end.index : undefined).split("\n")) {
    const step = /^ {8}run: (?<command>.*)$/u.exec(line);
    if (step && step.groups.command !== "|") commands.push(step.groups.command);
  }
  return commands;
}

test("SPEC.md reproduces the prepare gates the CI workflow runs", () => {
  const gates = jobCommands(read(".github/workflows/ci.yml"), "prepare");
  const block = specFence("17. CI workflow", "bash");
  const start = block.indexOf("# prepare");
  const end = block.indexOf("# projects");
  assert.ok(
    start !== -1 && end > start,
    "the §17 block of SPEC.md no longer marks where the prepare gates end and the per-project commands begin",
  );
  const listed = block
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(
    listed,
    gates,
    "SPEC.md §17 lists the prepare gates as ci.yml runs them; a gate added to the workflow, dropped or reordered there and left behind in the section makes the Draft describe a run nobody has",
  );
});

test("SPEC.md quotes commands the root package.json declares", () => {
  const excerpt = specBlock("22. Repository-level scripts").scripts;
  const shipped = readJson(new URL("../package.json", import.meta.url)).scripts;
  assert.ok(
    Object.keys(excerpt).length > 0,
    "the §22 excerpt names no script at all",
  );
  for (const [name, command] of Object.entries(excerpt)) {
    assert.equal(
      shipped[name],
      command,
      `SPEC.md §22 quotes \`${name}\` as \`${command}\`, but package.json ${
        name in shipped
          ? `now runs \`${shipped[name]}\``
          : "does not declare it"
      }`,
    );
  }
});

/** The tag names one remote advertises, peeled duplicates folded; `null` where it does not answer. */
function lsRemoteTags(remote) {
  const result = spawnSync("git", ["ls-remote", "--tags", remote], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20_000,
    // An https remote wanting credentials would prompt on a terminal nobody
    // reads, and the gate would hang instead of reporting the census unmeasured.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) return null;
  return result.stdout
    .split("\n")
    .map((line) => /^\S+\trefs\/tags\/(?<name>.+)$/u.exec(line)?.groups.name)
    .filter((name) => name !== undefined && !name.endsWith("^{}"));
}

/**
 * The tags the repository holds, read from the remotes of this checkout:
 * `{ names, remotes, unreachable }`.
 *
 * The census asks the remotes rather than `git tag -l`, because a local ref
 * store is not the state of the repository: a tag the remotes rewrote away
 * stays in a clone until someone runs `git fetch --prune-tags`, and the
 * housekeeping refs a working clone accumulates (`backup/*`, `pre-rebase*`)
 * were never part of §20's claim. So a clone older than the rewrite fails
 * `pnpm test:release` over a tag the section does not speak of, and the reader
 * is left choosing between rewriting §20 to match a local accident and
 * weakening the gate. `git ls-remote --tags` answers the same in a fresh clone
 * and a stale one, which is the answer §20 dates. How deep a CI checkout
 * fetched has stopped mattering for the same reason: `prepare` fetches with
 * `fetch-depth: 0` and the `projects` job of `ci.yml` does not, and neither
 * number bounds what a remote advertises.
 */
function remoteCensus() {
  const remotes = git("remote").output.split("\n").filter(Boolean);
  const names = new Set();
  const unreachable = [];
  for (const remote of remotes) {
    const advertised = lsRemoteTags(remote);
    if (advertised === null) {
      unreachable.push(remote);
    } else {
      for (const name of advertised) names.add(name);
    }
  }
  return { names: [...names].sort(), remotes, unreachable };
}

test("SPEC.md §20's tag census still comes back empty", (t) => {
  const { names, remotes, unreachable } = remoteCensus();
  // §20 states a fact about the repository, so this case is a verdict only over a
  // read that saw every remote of this checkout. A remote that stayed silent may
  // still carry a `name@version` tag, and asserting over the remotes that did
  // answer would report a census nobody finished as coverage.
  if (remotes.length === 0) {
    return t.skip(
      "this checkout points at no remote, so its tag set is unmeasured rather than empty",
    );
  }
  if (unreachable.length > 0) {
    return t.skip(
      unreachable.length === remotes.length
        ? `none of the ${remotes.length} remotes this checkout points at answered, so its tag set is unmeasured rather than empty`
        : `${unreachable.join(", ")} did not answer, so the census cannot say which tags it carries`,
    );
  }
  // The proxy for "the per-package scheme left nothing" is the wave tags: a
  // remote that carries no `release/*` is a fork or a rewrite, not this
  // history, and an empty `name@version` half proves nothing about it.
  if (!names.some((name) => name.startsWith("release/"))) {
    return t.skip(
      "no remote of this checkout advertises a release/* tag, so the census cannot tell an empty tag scheme from a history these remotes do not carry",
    );
  }
  assert.deepEqual(
    names.filter((name) => name.includes("@")),
    [],
    "SPEC.md §20 states that nothing of the per-package tag scheme is left to read; a tag of that shape makes the scheme live again, and `releaseTag.pattern` in §14 with it",
  );
});
