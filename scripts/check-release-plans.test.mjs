import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";

const script = fileURLToPath(
  new URL("./check-release-plans.mjs", import.meta.url),
);
const fixtures = [];

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, CI: "true" },
  });
}

function git(root, ...args) {
  const result = run("git", args, root);
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

function commit(root, message) {
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function writePackage(root, directory, name, version, extra = {}) {
  mkdirSync(path.join(root, directory), { recursive: true });
  writeJson(path.join(root, directory, "package.json"), {
    name,
    version,
    ...extra,
  });
  writeFileSync(path.join(root, directory, "index.js"), "export const x = 1;\n");
}

function editSource(root, directory, contents) {
  writeFileSync(path.join(root, directory, "index.js"), contents);
}

function writePlan(root, fileName, entries) {
  writeFileSync(
    path.join(root, ".nx", "version-plans", fileName),
    [
      "---",
      ...entries.map(([project, bump]) => `"${project}": ${bump}`),
      "---",
      "",
      "A changed behaviour worth releasing.",
      "",
    ].join("\n"),
  );
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-release-plans-"));
  fixtures.push(root);

  writeJson(path.join(root, "nx.json"), {
    release: {
      projects: ["plugins/*", "packages/*"],
      versionPlans: {
        ignorePatternsForPlanCheck: ["**/CHANGELOG.md", "**/package.json"],
      },
      releaseTag: { pattern: "{projectName}@{version}" },
    },
  });
  mkdirSync(path.join(root, ".nx", "version-plans"), { recursive: true });
  writePackage(root, "plugins/dsh-alpha", "@fixture/dsh-alpha", "1.0.0");
  writePackage(root, "plugins/dsh-beta", "@fixture/dsh-beta", "1.0.0");
  writePackage(root, "packages/kit", "@fixture/kit", "1.0.0", {
    private: true,
  });
  writePackage(root, "packages/log", "@fixture/log", "0.1.0");

  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Release Plan Test");
  git(root, "config", "user.email", "release-plan@example.com");

  const base = commit(root, "test: base");
  return { root, base };
}

function check(root, base) {
  const result = run(
    process.execPath,
    [script, `--base=${base}`, "--head=HEAD"],
    root,
  );
  return {
    ...result,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("version plan gate", () => {
  test("a release tag that covers the branch's change needs no plan", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    git(root, "tag", "@fixture/dsh-alpha@1.1.0");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /all covered by a plan/u);
    assert.match(result.output, /3 project\(s\) were released/u);
  });

  test("a change after the last release tag needs a plan", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    git(root, "tag", "@fixture/dsh-alpha@1.1.0");
    editSource(root, "plugins/dsh-alpha", "export const x = 3;\n");
    commit(root, "feat: change alpha again");

    const result = check(root, base);

    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /@fixture\/dsh-alpha: 1 file\(s\) since @fixture\/dsh-alpha@1\.1\.0/u,
    );
    assert.match(result.output, /pnpm release:plan/u);
    assert.doesNotMatch(result.output, /@fixture\/dsh-beta/u);
  });

  test("a release wave tag covers every project the wave released", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    editSource(root, "plugins/dsh-beta", "export const x = 2;\n");
    commit(root, "feat: change alpha and beta");
    git(root, "tag", "release/2026-09-14");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /3 project\(s\) were released/u);
  });

  test("a change after the wave tag needs a plan", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    git(root, "tag", "release/2026-09-14");
    editSource(root, "plugins/dsh-alpha", "export const x = 3;\n");
    commit(root, "feat: change alpha again");

    const result = check(root, base);

    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /@fixture\/dsh-alpha: 1 file\(s\) since release\/2026-09-14/u,
    );
    assert.doesNotMatch(result.output, /@fixture\/dsh-beta/u);
  });

  test("a wave tag anchors every project, even one a per-project tag left behind", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    git(root, "tag", "@fixture/dsh-alpha@1.1.0");
    editSource(root, "plugins/dsh-beta", "export const x = 2;\n");
    commit(root, "feat: change beta");
    git(root, "tag", "release/2026-09-14");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /3 project\(s\) were released/u);
  });

  test("a plan file covers an unreleased change", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    writePlan(root, "alpha.md", [["@fixture/dsh-alpha", "minor"]]);

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(
      result.output,
      /1 of 3 publishable project\(s\) carry unreleased changes/u,
    );
  });

  test("a project that never shipped is asked for the plan it needs to", () => {
    const { root, base } = createFixture();
    writePackage(root, "plugins/dsh-gamma", "@fixture/dsh-gamma", "1.0.0");
    commit(root, "feat: add gamma");

    const result = check(root, base);

    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /@fixture\/dsh-gamma: 2 file\(s\) since .* \(never released\)/u,
    );
    assert.doesNotMatch(result.output, /@fixture\/dsh-alpha/u);
  });

  test("a version and changelog bump alone needs no plan", () => {
    const { root, base } = createFixture();
    const manifestPath = path.join(root, "plugins/dsh-alpha/package.json");
    writeJson(manifestPath, { name: "@fixture/dsh-alpha", version: "1.1.0" });
    writeFileSync(path.join(root, "plugins/dsh-alpha/CHANGELOG.md"), "# 1.1.0\n");
    commit(root, "chore(release): publish");
    git(root, "tag", "@fixture/dsh-alpha@1.1.0");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /3 project\(s\) were released/u);
  });

  test("a private package is never asked for a plan", () => {
    const { root, base } = createFixture();
    editSource(root, "packages/kit", "export const x = 2;\n");
    commit(root, "chore: change the private kit");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /kit/u);
  });

  test("a base the repository cannot resolve fails instead of passing everything", () => {
    const { root } = createFixture();

    const result = check(root, "no-such-ref");

    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /"no-such-ref" is not a commit this repository can resolve/u,
    );
  });

  test("an uncommitted edit is reported as not yet checked", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");

    const result = check(root, base);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /1 path\(s\) under release projects are uncommitted/u);
  });

  test("a plan without the front-matter fence does not cover the change", () => {
    const { root, base } = createFixture();
    editSource(root, "plugins/dsh-alpha", "export const x = 2;\n");
    commit(root, "feat: change alpha");
    writeFileSync(
      path.join(root, ".nx/version-plans/alpha.md"),
      ['"@fixture/dsh-alpha": minor', "", "No front matter.", ""].join("\n"),
    );

    const result = check(root, base);

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /@fixture\/dsh-alpha/u);
  });
});
