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
import {
  findUnpublishedPackages,
  isPackagePublished,
  parsePackageSpec,
  readReleaseRows,
  unpublishedPackagesMessage,
} from "./verify-package-publication.mjs";

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
const npmCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const pnpmCli = process.env.npm_execpath;

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
    shell: options.shell ?? false,
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
    `${description} failed.\nerror:\n${result.error?.message ?? ""}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
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
    const result = runNx(
      root,
      "release",
      "plan:check",
      "--base=HEAD",
      "--head=HEAD",
    );

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
    assert.doesNotMatch(
      workflow,
      /--skip-publish\s+--yes|--yes\s+--skip-publish/u,
    );

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

    assertSucceeded(
      result,
      "nx release --skip-publish --first-release --dry-run",
    );
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

  test("the workflow publishes prepared tarballs through npm in dry-run mode", () => {
    const workflow = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    assert.match(workflow, /publish_only:/u);
    assert.match(workflow, /npm install --global npm@\^11\.15\.0/u);
    assert.match(workflow, /npm publish "\$\{args\[@\]\}"/u);
    assert.match(
      workflow,
      /if npm view "\$\{name\}@\$\{version\}" version --json > \/dev\/null 2>&1; then/u,
    );
    assert.doesNotMatch(
      workflow,
      /if \[\[ "\$\{\{ inputs\.dry_run \}\}" == "false" \]\] && npm view/u,
    );
    assert.match(
      workflow,
      /tarball_path="\$GITHUB_WORKSPACE\/tarballs\/\$tarball"/u,
    );
    assert.match(workflow, /\[\[ ! -f "\$tarball_path" \]\]/u);
    assert.doesNotMatch(workflow, /args=\("tarballs\/\$\{tarball\}"/u);
    assert.doesNotMatch(workflow, /pnpm nx release publish/u);
    assert.match(
      workflow,
      /create_github_releases:\s+[\s\S]*?default: true\s+[\s\S]*?type: boolean/u,
    );
    assert.match(
      workflow,
      /- name: Create per-package GitHub Releases\s+if: inputs\.dry_run == false && inputs\.create_github_releases/u,
    );

    const root = createFixture();
    const before = repositoryState(root);
    const tarballs = path.join(root, "tarballs");
    mkdirSync(tarballs);
    const packageRoot = path.join(root, "packages", "release-package");
    assert.ok(pnpmCli, "npm_execpath must identify the pnpm CLI");
    const pack = run(
      process.execPath,
      [pnpmCli, "--dir", packageRoot, "pack", "--pack-destination", tarballs],
      root,
    );
    assertSucceeded(pack, "pnpm pack");

    const [tarball] = readdirSync(tarballs).filter((file) =>
      file.endsWith(".tgz"),
    );
    assert.ok(tarball, "pnpm pack did not create a tarball");
    const publishArgs = [
      "publish",
      path.join(tarballs, tarball),
      "--access",
      "public",
      "--dry-run",
    ];
    const publish =
      process.platform === "win32"
        ? run(process.execPath, [npmCli, ...publishArgs], root)
        : run("npm", publishArgs, root);

    assertSucceeded(publish, "npm publish <tarball> --dry-run");
    assert.match(`${publish.stdout}\n${publish.stderr}`, /dry.?run/iu);
    assert.deepEqual(repositoryState(root), before);
  });

  test("the workflow publishes before it pushes the release commit", () => {
    const workflow = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const step = (name) => {
      const index = workflow.indexOf(`- name: ${name}`);
      assert.notEqual(index, -1, `the workflow has no "${name}" step`);
      return index;
    };

    const preflight = step("Verify packages exist on npm");
    const artifacts = step("Upload release artifacts");
    const publish = step("Publish to npm with OIDC");
    const push = step("Push release commit and tags");
    const githubReleases = step("Create per-package GitHub Releases");

    assert.ok(
      preflight < publish,
      "the registry check must run before the publish loop",
    );
    assert.ok(
      artifacts < publish,
      "the tarballs must be uploaded even when publishing fails",
    );
    assert.ok(
      publish < push,
      "npm publication must finish before the release commit is pushed",
    );
    assert.ok(push < githubReleases, "GitHub Releases are built from pushed tags");
    assert.match(workflow, /if ! npm publish "\$\{args\[@\]\}"; then/u);
    assert.match(workflow, /Failed to publish %d package\(s\)/u);
  });
});

describe("package publication gate", () => {
  test("a package the registry does not know is reported with its bootstrap", async () => {
    const packages = [
      {
        name: "@yadsh/dsh-known",
        version: "1.0.0",
        tarball: "yadsh-dsh-known-1.0.0.tgz",
      },
      {
        name: "@yadsh/dsh-new",
        version: "0.1.0",
        tarball: "yadsh-dsh-new-0.1.0.tgz",
      },
    ];
    const unpublished = await findUnpublishedPackages(packages, {
      lookup: async (name) => name !== "@yadsh/dsh-new",
    });

    assert.deepEqual(
      unpublished.map((item) => item.name),
      ["@yadsh/dsh-new"],
    );
    const message = unpublishedPackagesMessage(unpublished);
    assert.match(message, /@yadsh\/dsh-new@0\.1\.0\s+\(yadsh-dsh-new-0\.1\.0\.tgz\)/u);
    assert.match(message, /npm publish \.\/<tarball>\.tgz --access public/u);
    assert.match(message, /Trusted Publisher/u);
    assert.match(message, /version plans are still intact/u);
  });

  test("a registry failure is not mistaken for an unpublished package", async () => {
    const respond = (status, ok) => async () => ({ status, ok });

    assert.equal(
      await isPackagePublished("@yadsh/dsh-any", { fetchImpl: respond(404, false) }),
      false,
    );
    assert.equal(
      await isPackagePublished("@yadsh/dsh-any", { fetchImpl: respond(200, true) }),
      true,
    );
    await assert.rejects(
      isPackagePublished("@yadsh/dsh-any", { fetchImpl: respond(500, false) }),
      /answered 500 for @yadsh\/dsh-any/u,
    );
  });

  test("a bootstrapped package is not blocked by the cached packument", async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return url.endsWith("/latest")
        ? { status: 200, ok: true }
        : { status: 404, ok: false };
    };

    assert.equal(await isPackagePublished("@yadsh/dsh-new", { fetchImpl }), true);
    assert.equal(seen.length, 2, "the version document must settle a 404");
    assert.match(seen[1], /\/latest$/u);

    const allGone = async () => ({ status: 404, ok: false });
    assert.equal(
      await isPackagePublished("@yadsh/dsh-new", { fetchImpl: allGone }),
      false,
    );
  });

  test("the release selection rows are read back verbatim", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "dsh-publication-"));
    fixtures.push(directory);
    const tsv = path.join(directory, "release-packages.tsv");
    writeFileSync(
      tsv,
      "@yadsh/dsh-a\t1.0.0\tplugins/dsh-a\tyadsh-dsh-a-1.0.0.tgz\n",
    );

    assert.deepEqual(readReleaseRows(tsv), [
      {
        name: "@yadsh/dsh-a",
        version: "1.0.0",
        directory: "plugins/dsh-a",
        tarball: "yadsh-dsh-a-1.0.0.tgz",
      },
    ]);
  });

  test("scoped package specs survive command-line parsing", () => {
    assert.deepEqual(parsePackageSpec("@yadsh/dsh-a"), {
      name: "@yadsh/dsh-a",
      version: "",
    });
    assert.deepEqual(parsePackageSpec("@yadsh/dsh-a@1.2.3"), {
      name: "@yadsh/dsh-a",
      version: "1.2.3",
    });
  });
});

describe("version plan gate", () => {
  const gate = path.join(
    repositoryRoot,
    "scripts",
    "verify-package-hygiene.mjs",
  );

  function runGate(root) {
    return run(process.execPath, [gate, "--version-plans-only"], root);
  }

  test("the release workflow requires a plan nx can parse", () => {
    const workflow = readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );

    assert.match(
      workflow,
      /- name: Require a valid version plan\s+if: inputs\.publish_only == false\s+run: node scripts\/verify-package-hygiene\.mjs --version-plans-only/u,
    );
    assert.doesNotMatch(workflow, /compgen -G/u);
  });

  test("the gate rejects a plan that lost its front-matter fence", () => {
    const root = createFixture({ withVersionPlan: true });
    const planFile = path.join(root, ".nx", "version-plans", "release-test.md");
    const plan = readFileSync(planFile, "utf8");

    assertSucceeded(runGate(root), "version plan gate");

    writeFileSync(planFile, plan.replace(/^---\n/u, ""));
    const rejected = runGate(root);

    assert.notEqual(rejected.status, 0, "a damaged plan must fail the gate");
    assert.match(
      `${rejected.stdout}\n${rejected.stderr}`,
      /must open with --- on the first line/u,
    );
  });

  test("the gate requires at least one plan", () => {
    const rejected = runGate(createFixture());

    assert.notEqual(rejected.status, 0, "a planless release must fail the gate");
    assert.match(
      `${rejected.stdout}\n${rejected.stderr}`,
      /at least one version plan file is required/u,
    );
  });
});
