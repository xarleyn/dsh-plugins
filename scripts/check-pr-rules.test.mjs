import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { addedLines, inspectRange } from "./check-pr-rules.mjs";
import { identifierFindings } from "./pr-identifier-rules.mjs";

const packageFile = "plugins/dsh-fixture/package.json";
const qaChangelog =
  "plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx";
const qaPlan =
  '---\n"@yadsh/dsh-qa-surface": patch\n---\n\nImprove the demo.\n';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "pr-rules-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const commit = (files, message = "fixture: change") => {
    git("add", ...files);
    git("commit", "-m", message);
  };
  const manifest = (version, fields = {}) =>
    write(
      packageFile,
      JSON.stringify({ name: "@yadsh/dsh-fixture", version, ...fields }),
    );
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fixture Bot");
  git("config", "user.email", "fixture@bots.invalid");
  manifest("1.0.0");
  write(qaChangelog, 'const entry = { version: "0.7.5", items: ["Demo."] };\n');
  write("docs/demo.md", "A demo.\n");
  commit([packageFile, qaChangelog, "docs/demo.md"]);
  const base = git("rev-parse", "HEAD");
  const inspect = () => inspectRange({ repoRoot: root, base });
  return { root, git, write, commit, manifest, base, inspect };
}

test("added-line coordinates survive multiple hunks, context and removed rows", () => {
  assert.deepEqual(
    addedLines(
      "--- a/file\n+++ b/file\n@@ -2,2 +2,3 @@\n-old\n+new\n context\n+++literal\n@@ -20,0 +22,1 @@\n+later\n\\ No newline at end of file",
    ),
    [
      { line: 2, text: "new" },
      { line: 4, text: "++literal" },
      { line: 22, text: "later" },
    ],
  );
});

test("identifier rules allow exact placeholders and standards, with no arbitrary ticket family", () => {
  assert.deepEqual(
    identifierFindings(
      "PROJ-123 PROJ-456 RFC-1918 ISO-8601 ADR-123 DSH-0.1.7 jira.example.corp wiki.internal.example 192.0.2.10:8443",
    ),
    [],
  );
  assert.equal(
    identifierFindings(["PROJ", "789"].join("-"))[0].rule,
    "tracker-key",
  );
  assert.equal(
    identifierFindings(["DEMO", "789"].join("-"))[0].rule,
    "tracker-key",
  );
});

test("private marker shapes cannot exempt themselves with an inline comment", () => {
  for (const host of ["corp", "internal", "intranet", "lan", "local"]) {
    const text = `fixture.${host} // agents-rules: allow internal-host`;
    assert.equal(identifierFindings(text)[0].rule, "internal-host");
  }
  for (const host of [
    [10, 2, 3, 4],
    [172, 16, 2, 3],
    [172, 31, 2, 3],
    [192, 168, 2, 3],
  ]) {
    assert.equal(
      identifierFindings(`${host.join(".")}:8443`)[0].rule,
      "internal-address",
    );
  }
  assert.deepEqual(
    identifierFindings("Fixture Operator", { names: ["Fixture Operator"] }).map(
      (entry) => entry.rule,
    ),
    ["person-name"],
  );
  assert.deepEqual(
    identifierFindings("prefixedOperator", { names: ["Operator"] }),
    [],
  );
});

test("documented platform names and the exact local override path are not private hosts", () => {
  assert.deepEqual(
    identifierFindings(
      "https://Team.Example.CORP/root/ http://host.docker.internal:9222 `.dsh/doc-impact.local.yml`",
    ),
    [],
  );
  for (const text of [
    "https://doc-impact.local/",
    ".dsh/other.local.yml",
    "https://custom.host.docker.internal/",
    "https://host.docker.internal.corp/",
  ]) {
    assert.equal(identifierFindings(text)[0].rule, "internal-host");
  }
});

test("the range scanner reads added text, including tests, and exempts only deployment kits and locks", (t) => {
  const f = fixture(t);
  const marker = ["TEAM", "789"].join("-");
  const files = [
    "docs/demo.md",
    "plugins/dsh-fixture/tests/demo.ts",
    "qa-deploy/demo.md",
    "qa-deploy-docker/demo.md",
    ".portable/demo.md",
    "pnpm-lock.yaml",
  ];
  for (const file of files) f.write(file, `${marker}\n`);
  f.commit(files);
  assert.deepEqual(
    f.inspect().findings.map((finding) => [finding.file, finding.rule]),
    [
      ["docs/demo.md", "tracker-key"],
      ["plugins/dsh-fixture/tests/demo.ts", "tracker-key"],
    ],
  );
});

test("an inherited identifier removed by this change is not reported", (t) => {
  const f = fixture(t);
  f.write("docs/demo.md", `${["TEAM", "789"].join("-")}\n`);
  f.commit(["docs/demo.md"]);
  const base = f.git("rev-parse", "HEAD");
  f.write("docs/demo.md", "PROJ-123\n");
  f.commit(["docs/demo.md"]);
  assert.equal(inspectRange({ repoRoot: f.root, base }).findings.length, 0);
});

test("comparison uses the merge base and ignores changes on the target branch", (t) => {
  const f = fixture(t);
  f.write("docs/demo.md", `${["TEAM", "789"].join("-")}\n`);
  f.commit(["docs/demo.md"]);
  const target = f.git("rev-parse", "HEAD");
  f.git("switch", "-c", "feature", f.base);
  f.write("docs/feature.md", "A new demo.\n");
  f.commit(["docs/feature.md"]);
  assert.equal(
    inspectRange({ repoRoot: f.root, base: target }).findings.length,
    0,
  );
});

test("a changed QA plan cannot reuse an unchanged pre-existing curated entry", (t) => {
  const f = fixture(t);
  f.write(".nx/version-plans/demo.md", qaPlan);
  f.commit([".nx/version-plans/demo.md"]);
  assert.equal(f.inspect().findings[0].rule, "qa-changelog-pair");
  f.write(
    qaChangelog,
    'const entry = { version: "0.7.5", items: ["Updated demo."] };\n',
  );
  f.commit([qaChangelog]);
  assert.equal(f.inspect().findings.length, 0);
});

test("a plan deletion during release needs no new curated edit", (t) => {
  const f = fixture(t);
  f.write(".nx/version-plans/demo.md", qaPlan);
  f.commit([".nx/version-plans/demo.md"]);
  const base = f.git("rev-parse", "HEAD");
  f.git("rm", ".nx/version-plans/demo.md");
  f.git("commit", "-m", "chore(release): publish");
  assert.equal(inspectRange({ repoRoot: f.root, base }).findings.length, 0);
});

test("integration URLs name an existing full scoped package", (t) => {
  const f = fixture(t);
  const source = "plugins/dsh-fixture/tests/demo.ts";
  f.write(source, `fetch("/plugins/${"dsh-fixture"}/client.js");\n`);
  f.commit([source]);
  assert.equal(f.inspect().findings[0].rule, "client-bundle-path");
  f.write(source, `fetch("/plugins/${"@yadsh/dsh-fixture"}/client.js");\n`);
  f.commit([source]);
  assert.equal(f.inspect().findings.length, 0);
});

test("manual version edits fail while metadata edits and new packages pass", (t) => {
  const f = fixture(t);
  f.manifest("1.0.1");
  f.commit([packageFile]);
  assert.equal(f.inspect().findings[0].rule, "manual-version-bump");
  f.manifest("1.0.0", { description: "Demo package" });
  f.write(
    "packages/demo/package.json",
    JSON.stringify({ name: "@yadsh/demo", version: "1.0.0" }),
  );
  f.commit([packageFile, "packages/demo/package.json"]);
  assert.equal(f.inspect().findings.length, 0);
});

test("a genuine version materialization does not exempt a later manual bump", (t) => {
  const f = fixture(t);
  f.manifest("1.0.1");
  f.commit([packageFile], "chore(release): publish");
  assert.equal(f.inspect().findings.length, 0);
  f.manifest("1.0.2");
  f.commit([packageFile]);
  assert.equal(f.inspect().findings[0].rule, "manual-version-bump");
});

test("a later release materialization cannot hide an earlier manual bump", (t) => {
  const f = fixture(t);
  f.manifest("1.0.1");
  f.commit([packageFile], "fixture: manual version edit");
  f.manifest("1.0.2");
  f.commit([packageFile], "chore(release): publish");
  assert.equal(f.inspect().findings[0].rule, "manual-version-bump");
});

test("CLI returns 1 for violations, 2 for missing refs/options and 0 for a clean range", (t) => {
  const f = fixture(t);
  const script = fileURLToPath(
    new URL("./check-pr-rules.mjs", import.meta.url),
  );
  const cli = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: f.root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, NX_BASE: "", NX_HEAD: "" },
    });
  const args = [`--base=${f.base}`, "--head=HEAD"];
  assert.equal(cli(...args).status, 0);
  assert.equal(cli("--base=missing-ref").status, 2);
  assert.equal(cli(...args, "--json").status, 2);
  f.write("docs/demo.md", `${["TEAM", "789"].join("-")}\n`);
  f.commit(["docs/demo.md"]);
  assert.equal(cli(...args).status, 1);
  f.write("docs/demo.md", "Fixture Operator\n");
  f.write("names.txt", "# private dictionary\nFixture Operator\n");
  f.commit(["docs/demo.md"]);
  assert.equal(cli(...args).status, 0);
  assert.equal(
    cli(...args, `--names-file=${path.join(f.root, "names.txt")}`).status,
    1,
  );
  assert.equal(cli(...args, "--names-file=missing-file").status, 2);
});
