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
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const BLAME_FILE = ".git-blame-ignore-revs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTRIBUTING = fileURLToPath(
  new URL("../CONTRIBUTING.md", import.meta.url),
);

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
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
