import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { buildWaveNotes, changelogSection } from "./wave-release-notes.mjs";

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
  const env = {
    ...process.env,
    CI: "true",
    NX_DAEMON: "false",
    NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
  };
  // `nrwl/nx-set-shas` exports the shas the job compares against, and they
  // describe the repository the job checked out, not the fixture a test just
  // built: whoever inherits them reads refs the fixture cannot resolve.
  delete env.NX_BASE;
  delete env.NX_HEAD;

  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
    shell: options.shell ?? false,
    env: { ...env, ...options.env },
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
      git: { tag: false },
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

  test("the version plan gate reads an unreleased change against the fixture plan", () => {
    const root = createFixture({ withVersionPlan: true });
    writeFileSync(
      path.join(root, "packages", "release-package", "index.js"),
      "export const fixture = 2;\n",
    );
    assertSucceeded(run("git", ["add", "--all"], root), "git add");
    assertSucceeded(
      run("git", ["commit", "--quiet", "-m", "feat: change the fixture"], root),
      "git commit",
    );
    const before = repositoryState(root);
    const base = run("git", ["rev-parse", "HEAD~1"], root).stdout.trim();
    const result = run(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "check-release-plans.mjs"),
        `--base=${base}`,
      ],
      root,
    );

    assertSucceeded(result, "pnpm release:check");
    assert.match(result.stdout, /all covered by a plan/u);
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

  test("a release commit is created without per-project tags", () => {
    const root = createFixture({ withVersionPlan: true });
    const before = repositoryState(root);
    const result = runNx(root, "release", "--skip-publish");

    assertSucceeded(result, "nx release --skip-publish");
    const state = repositoryState(root);
    assert.notEqual(state.head, before.head, "the release commit must exist");
    assert.match(state.manifest, /"version": "1\.0\.1"/u);
    assert.deepEqual(
      state.plans,
      [],
      "the release must consume the version plans",
    );
    assert.equal(
      state.tags,
      before.tags,
      "the release must not create tags; the workflow adds one wave tag",
    );
  });

  // The workflow validates a release on more than one runner, and the versioned
  // tree reaches them as a patch of the release commit: that commit only ever
  // exists on the runner that created it. A commit nx cannot replay would leave
  // the other jobs verifying, packing and eventually pushing the previous
  // versions, and a release that kept the plans it consumed would apply them
  // again on the next run.
  test("the release commit replays in a checkout that does not have it yet", () => {
    const root = createFixture({ withVersionPlan: true });
    const base = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
    assertSucceeded(runNx(root, "release", "--skip-publish"), "nx release");

    // Nx removes the consumed version plans outside its own commit; the
    // workflow stages the workspace and folds that into the release commit
    // before it travels.
    const staged = run("git", ["status", "--porcelain"], root).stdout;
    assert.match(
      staged,
      / D \.nx\/version-plans\/release-test\.md/u,
      "the fixture must exercise the plan removal Nx leaves uncommitted",
    );
    assertSucceeded(run("git", ["add", "--all"], root), "git add --all");
    assertSucceeded(
      run("git", ["commit", "--amend", "--no-edit"], root),
      "git commit --amend",
    );
    const releasedSubject = run(
      "git",
      ["log", "-1", "--format=%s"],
      root,
    ).stdout.trim();

    const patch = run(
      "git",
      ["format-patch", "--stdout", `${base}..HEAD`],
      root,
    ).stdout;
    assert.match(patch, /^From [0-9a-f]{40} /mu, "format-patch output");

    // A later job gets a fresh checkout of the released ref, which does not
    // carry the release commit.
    const checkout = mkdtempSync(path.join(tmpdir(), "dsh-release-checkout-"));
    fixtures.push(checkout);
    assertSucceeded(
      run("git", ["clone", "--quiet", root, checkout], tmpdir()),
      "git clone",
    );
    assertSucceeded(
      run("git", ["reset", "--quiet", "--hard", "HEAD~1"], checkout),
      "git reset",
    );
    for (const args of [
      ["config", "user.name", "Release Test"],
      ["config", "user.email", "release-test@example.com"],
    ]) {
      assertSucceeded(run("git", args, checkout), `git ${args.join(" ")}`);
    }

    // The workflow hands the patch to the other jobs from outside the
    // workspace, so the replay leaves the checkout clean.
    const patchDirectory = mkdtempSync(
      path.join(tmpdir(), "dsh-release-patch-"),
    );
    fixtures.push(patchDirectory);
    const patchFile = path.join(patchDirectory, "release-commit.patch");
    writeFileSync(patchFile, patch);
    assertSucceeded(run("git", ["am", patchFile], checkout), "git am");

    assert.match(
      readFileSync(
        path.join(checkout, "packages", "release-package", "package.json"),
        "utf8",
      ),
      /"version": "1\.0\.1"/u,
      "the replayed commit must carry the resolved version",
    );
    assert.equal(
      existsSync(
        path.join(checkout, ".nx", "version-plans", "release-test.md"),
      ),
      false,
      "the replayed commit must consume the version plans",
    );
    assert.equal(
      run("git", ["log", "-1", "--format=%s"], checkout).stdout.trim(),
      releasedSubject,
      "the replayed commit must keep the message nx wrote",
    );
    assert.equal(
      run("git", ["status", "--porcelain"], checkout).stdout.trim(),
      "",
      "the replayed commit must leave no uncommitted change behind",
    );
  });

  test("the repository release config stops creating per-project tags", () => {
    const nxConfig = JSON.parse(
      readFileSync(path.join(repositoryRoot, "nx.json"), "utf8"),
    );
    assert.equal(
      nxConfig.release?.git?.tag,
      false,
      "nx must leave tagging to the workflow's wave tag",
    );
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
      /- name: Create the release-wave GitHub Release\s+if: inputs\.dry_run == false && inputs\.create_github_releases/u,
    );
    assert.match(workflow, /- name: Tag the release wave/u);
    assert.match(workflow, /git tag -a "\$wave_tag" -m "Release wave/u);
    assert.match(
      workflow,
      /node scripts\/wave-release-notes\.mjs --tsv="\$RUNNER_TEMP\/release-packages\.tsv"/u,
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
    const waveTag = step("Tag the release wave");
    const push = step("Push release commit and tags");
    const githubReleases = step("Create the release-wave GitHub Release");

    assert.ok(
      preflight < publish,
      "the registry check must run before the publish loop",
    );
    assert.ok(
      artifacts < publish,
      "the tarballs must be uploaded even when publishing fails",
    );
    assert.ok(
      publish < waveTag,
      "the wave tag is only created for versions npm already has",
    );
    assert.ok(
      waveTag < push,
      "the wave tag must be pushed with the release commit",
    );
    assert.ok(
      push < githubReleases,
      "the GitHub Release is built from the pushed wave tag",
    );
    assert.match(workflow, /if ! npm publish "\$\{args\[@\]\}"; then/u);
    assert.match(workflow, /Failed to publish %d package\(s\)/u);
  });
});

describe("release workflow fan-out", () => {
  function releaseWorkflow() {
    return readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
  }

  test("the release fans the released packages out and sweeps the rest", () => {
    const workflow = releaseWorkflow();

    assert.match(workflow, /--format=release-matrix/u);
    assert.match(
      workflow,
      /DSH_ALL_PROJECTS_JSON="\$\(pnpm nx show projects --json\)"/u,
    );
    assert.match(
      workflow,
      /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.matrix\) \}\}/u,
    );
    assert.match(workflow, /max-parallel: 6/u);
    assert.match(
      workflow,
      /NX_PROJECT: \$\{\{ matrix\.project \}\}\s+run: pnpm nx run-many -t lint typecheck test build verify --projects="\$NX_PROJECT" --output-style=static/u,
    );
    assert.match(
      workflow,
      /if: needs\.prepare\.outputs\.gates_projects != ''\s+env:\s+NX_PROJECTS: \$\{\{ needs\.prepare\.outputs\.gates_projects \}\}\s+run: pnpm nx run-many -t lint typecheck test build verify --projects="\$NX_PROJECTS" --output-style=static/u,
    );

    // The sequential pass over the whole workspace this replaces is what cost a
    // release minutes of a single runner's time; a released package is verified
    // by its own job and every other project by the sweep beside it.
    assert.doesNotMatch(workflow, /pnpm check/u);

    const jobs = [
      "name: Prepare the release",
      "name: Repository gates",
      "name: Package /",
      "name: Publish the release",
    ].map((name) => {
      const index = workflow.indexOf(name);
      assert.notEqual(index, -1, `the workflow has no "${name}" job`);
      return index;
    });
    assert.ok(
      jobs[0] < jobs[1] && jobs[1] < jobs[3],
      "the repository gates run between prepare and publish",
    );
    assert.ok(
      jobs[0] < jobs[2] && jobs[2] < jobs[3],
      "the package matrix runs between prepare and publish",
    );
  });

  test("the release verifies the same repository gates the PR workflow runs", () => {
    const workflow = releaseWorkflow();

    for (const step of [
      "Check dependency boundaries",
      "Lint repository tooling",
      "Check formatting",
      "Verify plugin logging contract",
      "Verify publishable plugin package hygiene",
      "Test repository tooling",
    ]) {
      assert.ok(
        workflow.includes(`- name: ${step}`),
        `the release must run "${step}"`,
      );
    }
  });

  test("the release commit and the tarballs travel between the jobs", () => {
    const workflow = releaseWorkflow();

    assert.match(
      workflow,
      /git rev-parse HEAD > "\$RUNNER_TEMP\/release-base\.sha"/u,
    );
    assert.match(
      workflow,
      /git format-patch --stdout "\$base"\.\.HEAD > "\$RUNNER_TEMP\/release-commit\.patch"/u,
    );
    // Nx leaves the consumed version plans outside its commit, so the workflow
    // stages the workspace and folds them in - but only ever into a commit this
    // run created: the base commit is pushed already.
    assert.match(
      workflow,
      /git add --all\s+if ! git diff --cached --quiet; then\s+if \[\[ "\$\(git rev-parse HEAD\)" == "\$base" \]\]/u,
    );
    assert.match(
      workflow,
      /name: release-commit\s+path: \$\{\{ runner\.temp \}\}\/release-commit\.patch\s+if-no-files-found: error/u,
    );
    assert.equal(
      (workflow.match(/git am "\$RUNNER_TEMP\/release-commit\.patch"/gu) ?? [])
        .length,
      3,
      "the gates, the package matrix and the publish job must all replay the release commit",
    );

    assert.match(
      workflow,
      /name: npm-tarball-\$\{\{ matrix\.slug \}\}\s+path: \$\{\{ github\.workspace \}\}\/tarballs\/\*\.tgz/u,
    );
    assert.match(
      workflow,
      /pattern: npm-tarball-\*\s+path: \$\{\{ github\.workspace \}\}\/tarballs\s+merge-multiple: true/u,
    );
    // An artifact is immutable within a run, so a rerun of one job would fail
    // to replace its own without this.
    assert.equal(
      (workflow.match(/overwrite: true/gu) ?? []).length,
      3,
      "every artifact upload must be able to replace itself on a rerun",
    );
  });

  test("a preview resolves no matrix and keeps every later job skipped", () => {
    const workflow = releaseWorkflow();

    assert.match(
      workflow,
      /printf 'count=0\\nprojects=\\ngates_projects=\\nmatrix=\{"include":\[\]\}\\n' >> "\$GITHUB_OUTPUT"/u,
    );
  });

  test("the release matrix names a released package per job", () => {
    const output = run(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "workspace-packages.mjs"),
        "--format=release-matrix",
        "--require",
      ],
      repositoryRoot,
      {
        env: {
          DSH_PROJECTS_JSON: JSON.stringify([
            "plugins/dsh-qa-surface",
            "@yadsh/dsh-cas-results",
          ]),
          DSH_ALL_PROJECTS_JSON: JSON.stringify([
            "@yadsh/dsh-cas-results",
            "@yadsh/dsh-config",
            "@yadsh/dsh-plugin-generator",
            "@yadsh/dsh-qa-surface",
          ]),
        },
      },
    );
    assertSucceeded(output, "workspace-packages.mjs --format=release-matrix");

    const fields = new Map(
      output.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/su).slice(0, 2)),
    );

    assert.equal(fields.get("count"), "2");
    assert.equal(
      fields.get("projects"),
      "@yadsh/dsh-cas-results,@yadsh/dsh-qa-surface",
    );
    assert.equal(
      fields.get("gates_projects"),
      "@yadsh/dsh-config,@yadsh/dsh-plugin-generator",
      "the sweep must keep the projects the release does not publish",
    );
    assert.deepEqual(JSON.parse(fields.get("matrix")), {
      include: [
        {
          project: "@yadsh/dsh-cas-results",
          directory: "plugins/dsh-cas-results",
          slug: "dsh-cas-results",
        },
        {
          project: "@yadsh/dsh-qa-surface",
          directory: "plugins/dsh-qa-surface",
          slug: "dsh-qa-surface",
        },
      ],
    });
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
    assert.match(
      message,
      /@yadsh\/dsh-new@0\.1\.0\s+\(yadsh-dsh-new-0\.1\.0\.tgz\)/u,
    );
    assert.match(message, /npm publish \.\/<tarball>\.tgz --access public/u);
    assert.match(message, /Trusted Publisher/u);
    assert.match(message, /version plans are still intact/u);
  });

  test("a registry failure is not mistaken for an unpublished package", async () => {
    const respond = (status, ok) => async () => ({ status, ok });

    assert.equal(
      await isPackagePublished("@yadsh/dsh-any", {
        fetchImpl: respond(404, false),
      }),
      false,
    );
    assert.equal(
      await isPackagePublished("@yadsh/dsh-any", {
        fetchImpl: respond(200, true),
      }),
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

    assert.equal(
      await isPackagePublished("@yadsh/dsh-new", { fetchImpl }),
      true,
    );
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

describe("wave release notes", () => {
  function writeChangelog(root, directory, sections) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(
      path.join(root, directory, "CHANGELOG.md"),
      sections.join("\n"),
    );
  }

  test("the notes carry each package's changelog entry for its released version", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-wave-notes-"));
    fixtures.push(root);
    writeChangelog(root, "plugins/dsh-a", [
      "## 1.1.0 (2026-09-14)",
      "",
      "### 🚀 Features",
      "",
      "- First feature.",
      "",
      "## 1.0.0 (2026-09-01)",
      "",
      "- Older entry.",
      "",
    ]);
    writeChangelog(root, "plugins/dsh-b", [
      "## 0.2.0",
      "",
      "- No date heading.",
      "",
    ]);

    const tsv = path.join(root, "release-packages.tsv");
    writeFileSync(
      tsv,
      [
        "@yadsh/dsh-a\t1.1.0\tplugins/dsh-a\tyadsh-dsh-a-1.1.0.tgz",
        "@yadsh/dsh-b\t0.2.0\tplugins/dsh-b\tyadsh-dsh-b-0.2.0.tgz",
      ].join("\n"),
    );

    const markdown = buildWaveNotes(readReleaseRows(tsv), root);

    assert.match(markdown, /^## @yadsh\/dsh-a 1\.1\.0$/mu);
    assert.match(markdown, /- First feature\./u);
    assert.doesNotMatch(markdown, /Older entry/u);
    assert.match(markdown, /^## @yadsh\/dsh-b 0\.2\.0$/mu);
    assert.match(markdown, /- No date heading\./u);
    assert.doesNotMatch(markdown, /No changelog entry/u);
  });

  test("a package without a changelog entry still gets its section", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-wave-notes-"));
    fixtures.push(root);

    const markdown = buildWaveNotes(
      [
        {
          name: "@yadsh/dsh-c",
          version: "0.1.0",
          directory: "plugins/dsh-c",
          tarball: "yadsh-dsh-c-0.1.0.tgz",
        },
      ],
      root,
    );

    assert.match(markdown, /^## @yadsh\/dsh-c 0\.1\.0$/mu);
    assert.match(markdown, /No changelog entry was found/u);
  });

  test("a version heading never absorbs a longer version's section", () => {
    const changelog = [
      "## 1.1.0 (2026-09-14)",
      "",
      "- Current entry.",
      "",
      "## 1.1.01 (2026-09-13)",
      "",
      "- Typo release.",
      "",
    ].join("\n");

    const section = changelogSection(changelog, "1.1.0");
    assert.match(section, /Current entry/u);
    assert.doesNotMatch(section, /Typo release/u);
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

    assert.notEqual(
      rejected.status,
      0,
      "a planless release must fail the gate",
    );
    assert.match(
      `${rejected.stdout}\n${rejected.stderr}`,
      /at least one version plan file is required/u,
    );
  });
});
