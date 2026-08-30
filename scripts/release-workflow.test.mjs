import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nxCli = path.join(
  repositoryRoot,
  "node_modules",
  "nx",
  "dist",
  "bin",
  "nx.js",
);
const fixtures = [];

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
    env: {
      ...process.env,
      CI: "true",
      NX_DAEMON: "false",
      NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
      ...options.env,
    },
  });
}

function assertSucceeded(result, description) {
  assert.equal(
    result.status,
    0,
    `${description} failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({ withVersionPlan = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-release-workflow-"));
  fixtures.push(root);
  mkdirSync(path.join(root, "packages", "release-package"), {
    recursive: true,
  });
  mkdirSync(path.join(root, ".nx", "version-plans"), { recursive: true });

  writeJson(path.join(root, "package.json"), {
    name: "release-workflow-fixture",
    private: true,
    packageManager: "pnpm@10.4.1",
    workspaces: ["packages/*"],
  });
  writeJson(path.join(root, "nx.json"), {
    release: {
      projects: ["packages/*"],
      projectsRelationship: "independent",
      versionPlans: true,
      releaseTag: { pattern: "{projectName}@{version}" },
      changelog: {
        workspaceChangelog: false,
        projectChangelogs: false,
      },
    },
  });
  writeJson(path.join(root, "packages", "release-package", "package.json"), {
    name: "@dsh-release-test/release-package",
    version: "1.0.0",
    type: "module",
    files: ["index.js"],
  });
  writeFileSync(
    path.join(root, "packages", "release-package", "index.js"),
    "export const fixture = true;\n",
  );
  writeFileSync(
    path.join(root, ".gitignore"),
    ".nx/cache/\n.nx/workspace-data/\nnode_modules/\n",
  );
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(root, "node_modules"),
    "junction",
  );

  if (withVersionPlan) {
    writeFileSync(
      path.join(root, ".nx", "version-plans", "release-test.md"),
      [
        "---",
        '"@dsh-release-test/release-package": patch',
        "---",
        "",
        "Verify the release workflow.",
        "",
      ].join("\n"),
    );
  }

  for (const args of [
    ["init", "--quiet"],
    ["config", "user.name", "Release Test"],
    ["config", "user.email", "release-test@example.com"],
    ["add", "."],
    ["commit", "--quiet", "-m", "test: initialize release fixture"],
    ["tag", "@dsh-release-test/release-package@1.0.0"],
  ]) {
    assertSucceeded(run("git", args, root), `git ${args.join(" ")}`);
  }

  return root;
}

function runNx(root, ...args) {
  return run(process.execPath, [nxCli, ...args], root);
}

function repositoryState(root) {
  const manifest = readFileSync(
    path.join(root, "packages", "release-package", "package.json"),
    "utf8",
  );
  const plans = readdirSync(path.join(root, ".nx", "version-plans"))
    .sort()
    .map((name) => [
      name,
      readFileSync(path.join(root, ".nx", "version-plans", name), "utf8"),
    ]);
  const head = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  const tags = run("git", ["tag", "--list"], root).stdout.trim();
  return { manifest, plans, head, tags };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("Nx release commands", () => {
  test("release plan previews without creating a plan", () => {
    const root = createFixture();
    const before = repositoryState(root);
    const result = runNx(
      root,
      "release",
      "plan",
      "patch",
      "--projects=@dsh-release-test/release-package",
      "--message=Preview a patch release",
      "--only-touched=false",
      "--dry-run",
    );

    assertSucceeded(result, "nx release plan --dry-run");
    assert.match(`${result.stdout}\n${result.stderr}`, /dry.?run/iu);
    assert.deepEqual(repositoryState(root), before);
  });

  test("release plan:check accepts the pending fixture plan", () => {
    const root = createFixture({ withVersionPlan: true });
    const before = repositoryState(root);
    const result = runNx(root, "release", "plan:check", "--base=HEAD", "--head=HEAD");

    assertSucceeded(result, "nx release plan:check");
    assert.deepEqual(repositoryState(root), before);
  });

  test("the workflow preview is valid and dry", () => {
    const root = createFixture({ withVersionPlan: true });
    const before = repositoryState(root);
    const result = runNx(root, "release", "--dry-run");

    assertSucceeded(result, "nx release --dry-run");
    assert.match(`${result.stdout}\n${result.stderr}`, /dry.?run/iu);
    assert.deepEqual(repositoryState(root), before);
  });

  test("the workflow's nonpublishing release invocation is valid and dry", () => {
    const workflow = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    assert.match(workflow, /args=\(--skip-publish\)/u);
    assert.doesNotMatch(workflow, /--skip-publish\s+--yes|--yes\s+--skip-publish/u);

    const root = createFixture({ withVersionPlan: true });
    const before = repositoryState(root);
    const result = runNx(root, "release", "--skip-publish", "--dry-run");

    assertSucceeded(result, "nx release --skip-publish --dry-run");
    assert.match(result.stdout, /Skipped publishing packages/iu);
    assert.deepEqual(repositoryState(root), before);
  });

  test("the first-release branch remains valid and dry", () => {
    const root = createFixture({ withVersionPlan: true });
    const before = repositoryState(root);
    const result = runNx(
      root,
      "release",
      "--skip-publish",
      "--first-release",
      "--dry-run",
    );

    assertSucceeded(result, "nx release --skip-publish --first-release --dry-run");
    assert.deepEqual(repositoryState(root), before);
  });

  test("release publish validates a package without publishing it", () => {
    const root = createFixture();
    const before = repositoryState(root);
    const result = runNx(
      root,
      "release",
      "publish",
      "--projects=@dsh-release-test/release-package",
      "--first-release",
      "--dry-run",
      "--output-style=static",
    );

    assertSucceeded(result, "nx release publish --dry-run");
    assert.match(`${result.stdout}\n${result.stderr}`, /dry.?run/iu);
    assert.deepEqual(repositoryState(root), before);
  });
});
