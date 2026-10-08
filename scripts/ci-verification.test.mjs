import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CANONICAL_SHELL_RULES,
  verifyPluginCardContract,
} from "./verify-plugin-card-contract.mjs";

const canonicalClient = [
  // Which contract applies is read off the seat the bundle registers on, so the
  // fixture has to name one — here the settings surface that owes us the shell.
  'slots.register({ name: "settings.plugins.tab" }, FixtureCard);',
  ...CANONICAL_SHELL_RULES,
  '<path d="m3.5 5.25 3.5 3.5 3.5-3.5"/>',
  // The sheet above only proves the shell is styled; the contract also reads
  // the two strings only the code that renders the shell produces.
  'const card = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";',
  'jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });',
].join("\n");

/** A card seated on the Plugins panel row, where the Host draws the chrome. */
const rowClient = [
  'slots.register({ name: "plugins.row.config", key: "@yadsh/dsh-fixture#fixture" }, RowCard);',
  'const RowCard = () => jsx("section", { className: "fixture-body" });',
  // A row card takes its ring from the Host's tokens; a bundle that ships none has
  // deleted the indicator rather than handed it over.
  ".fixture-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}",
].join("\n");

test("the CI workflow fans the projects it verifies out into a bounded matrix", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /pnpm nx show projects --affected --base="\$NX_BASE" --head="\$NX_HEAD" --json/u,
  );
  assert.match(
    workflow,
    /DSH_PROJECTS_JSON="\$projects_json" node scripts\/workspace-packages\.mjs --format=github-matrix/u,
  );
  assert.match(
    workflow,
    /concurrency:\s+group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s+cancel-in-progress: \$\{\{ github\.event_name != 'push' \}\}/u,
    "a cancelled push run leaves main unverified, so a newer push must queue behind it",
  );
  assert.match(
    workflow,
    /if \[ "\$GITHUB_EVENT_NAME" = "push" \]; then\s+projects_json="\$\(pnpm nx show projects --json\)"/u,
    "a push verifies the whole workspace; an affected set measured from the last green run hides whatever that run never reached",
  );
  assert.match(
    workflow,
    /projects_json="\$\(pnpm nx show projects --affected --base="\$NX_BASE" --head="\$NX_HEAD" --json\)"/u,
    "a pull request still answers only for its own change",
  );
  assert.match(
    workflow,
    /- name: Set affected SHAs\s+uses: nrwl\/nx-set-shas@v4\s+with:\s+workflow-id: ci\.yml/u,
    "push events on Gitea must not rely on an unavailable github.workflow value",
  );
  assert.match(workflow, /max-parallel: 20/u);
  assert.match(
    workflow,
    /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.matrix\) \}\}/u,
  );
  assert.match(
    workflow,
    /NX_PROJECT: \$\{\{ matrix\.project \}\}\s+run: pnpm nx run-many -t lint typecheck test build verify --projects="\$NX_PROJECT" --output-style=static/u,
  );
  assert.match(workflow, /- name: Check formatting\s+run: pnpm format/u);
  assert.match(
    workflow,
    /- name: Check file size budget\s+run: pnpm check:files/u,
    "a file that outgrew its budget has to fail a run, not only a review",
  );
  // Позиция внутри `prepare` — а не относительно имени соседнего шага: шаг
  // переименовывали (#407), и проверка по строке умерла бы на ровном месте.
  const prepareJob = workflow.slice(
    workflow.indexOf("  prepare:"),
    workflow.indexOf("  projects:"),
  );
  assert.ok(
    prepareJob.includes("- name: Check file size budget"),
    "the budget gate belongs to the prepare job, so the size of a pull request is reported without building every project",
  );
  // Bands are only as good as what they can see: `prepare` has no build output,
  // so a generated bundle is measured where a build has just written lib/.
  assert.match(
    workflow,
    /- name: Check built bundle size budget\s+run: pnpm check:files/u,
    "the generated-bundle band has to run after a build, or it reports nothing and reads as coverage",
  );
  const projectsJob = workflow.slice(
    workflow.indexOf("  projects:"),
    workflow.indexOf("  verify:"),
  );
  assert.ok(
    projectsJob.indexOf("- name: Verify project\n") <
      projectsJob.indexOf("- name: Check built bundle size budget"),
    "the bundle band runs in the project job, after that project has been built",
  );
  assert.match(
    workflow,
    /- name: Verify plugin logging contract\s+run: pnpm verify:logging/u,
  );
  assert.match(
    workflow,
    /- name: Verify publishable plugin package hygiene\s+run: pnpm verify:packages/u,
  );
  assert.match(
    workflow,
    /- name: Test repository tooling\s+run: pnpm test:release/u,
  );
  assert.match(
    workflow,
    /- name: Check version plans\s+run: pnpm release:check --base="\$NX_BASE" --head="\$NX_HEAD"/u,
  );
  assert.doesNotMatch(
    workflow,
    /- name: Check version plans\s+if:/u,
    "a pushed commit needs the plan gate as much as a pull request does",
  );
  assert.ok(
    workflow.indexOf("- name: Check version plans") <
      workflow.indexOf("- name: Select projects to verify"),
    "the version plan check must run before the projects to verify are selected",
  );
  assert.doesNotMatch(
    workflow,
    /branch_tags=|pnpm nx release plan:check/u,
    "the gate must read version plans through pnpm release:check",
  );
  assert.ok(
    workflow.indexOf("- name: Verify project") <
      workflow.indexOf("- name: Verify project tarball"),
    "project verification must build a package before tarball verification",
  );
  assert.match(
    workflow,
    /- name: Verify project tarball\s+if: matrix\.publishable\s+env:\s+PACKAGE_DIRECTORY: \$\{\{ matrix\.directory \}\}\s+run: pnpm tarball:verify:packages "\$PACKAGE_DIRECTORY"/u,
  );
  assert.match(workflow, /name: Verify projects\s+if: always\(\)/u);
});

/**
 * The argument list of every `playwright install` the workflow runs, each read
 * off the command line it appears on.
 *
 * The flag this file pins is named in the prose of the same step as well, so an
 * occurrence search over the whole file cannot tell the command from the comment
 * that explains it. Parsing the tail of the command is what keeps a reverted step
 * red.
 */
function playwrightInstallCommands(workflow) {
  return [...workflow.matchAll(/playwright install([^\n]*)/gu)].map(
    ([, tail]) => tail.trim().split(/\s+/u).filter(Boolean),
  );
}

test("the browser project's job installs Chromium together with its libraries", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const commands = playwrightInstallCommands(workflow);

  assert.equal(
    commands.length,
    1,
    "Chromium has to be installed in one command of one job, or this gate no longer knows which install it checked",
  );
  const [args] = commands;
  assert.ok(
    args.includes("chromium"),
    "the step takes only the browser the suite drives, not every Playwright build of the version",
  );
  assert.ok(
    args.includes("--with-deps"),
    "an image with no system browser has no Chromium libraries either, and a downloaded build without libnspr4 and its companions dies in the dynamic linker at exit 127, which the suite can only read as BROWSER_START_FAILED — so the build and its libraries have to arrive in one command",
  );

  // The revert this gate exists to catch: the flag leaves the command, the
  // sentence that justifies it stays. Both halves are asserted so the next reader
  // sees why the check parses rather than greps.
  const reverted = workflow.replace(
    "playwright install --with-deps chromium",
    "playwright install chromium",
  );
  assert.notEqual(
    reverted,
    workflow,
    "the install command has to read exactly `playwright install --with-deps chromium` for this mutation to be a mutation — a reformatted command needs this check updated with it",
  );
  assert.deepEqual(
    playwrightInstallCommands(reverted),
    [["chromium"]],
    "the arguments are read off the command line, so a command that lost the flag reads as one that lost the flag",
  );
  assert.match(
    reverted,
    /--with-deps/u,
    "the step's comment still names the flag: this is the text an occurrence search would have accepted as a passing install",
  );
});

test("the PR workflow also builds pull requests that target a release branch", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /pull_request:\s+branches: \[main, 'dsh-v\*'\]/u,
    "a pull request into a dsh-v* branch must run the same checks as main",
  );
  assert.match(
    workflow,
    /push:\s+branches: \[main\]/u,
    "direct pushes stay limited to main",
  );
});

test("the tooling test command still names every tooling test that exists", async () => {
  // CI runs `pnpm test:release`, whose value is a list of files written out one by
  // one. A test file added under one of these directories and left out of the list
  // is a gate no run ever executes, and describing the series by its mask — the way
  // `docs/VERIFICATION.md` put it until this check existed — is what hides the
  // difference, so the list and the directories are compared here rather than
  // trusted to the attention of whoever adds the next file.
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const command = manifest.scripts["test:release"];
  assert.match(
    command,
    /^node --test \S/u,
    "`test:release` no longer opens with `node --test` followed by its file list, so this check would be reading a different command",
  );
  const named = command
    .slice("node --test ".length)
    .trim()
    .split(/\s+/u)
    .sort();

  const onDisk = [];
  for (const directory of ["scripts", "packages/plugin-scripts"]) {
    for (const entry of await readdir(
      new URL(`../${directory}/`, import.meta.url),
    )) {
      if (entry.endsWith(".test.mjs")) onDisk.push(`${directory}/${entry}`);
    }
  }
  onDisk.sort();

  assert.deepEqual(
    named,
    onDisk,
    "`test:release` must name exactly the `*.test.mjs` files of `scripts/` and `packages/plugin-scripts/` — one entry each, no duplicates. A file on disk the command omits is a check that never runs; an entry with no file behind it fails `node --test` on the spot.",
  );
});

test("the CI matrix marks publishable plugins and shared packages for tarball verification", () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(
    new URL("./workspace-packages.mjs", import.meta.url),
  );
  const output = execFileSync(
    process.execPath,
    [script, "--format=github-matrix"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DSH_PROJECTS_JSON: JSON.stringify([
          "@yadsh/dsh-config",
          "@yadsh/dsh-cas-results",
          "@yadsh/dsh-plugin-log",
        ]),
      },
    },
  );
  const lines = new Map(
    output
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/su).slice(0, 2)),
  );

  assert.equal(lines.get("count"), "3");
  // A shared package has to reach the matrix the same way a plugin does: the
  // per-project job is what runs its `verify` gate and `matrix.publishable` is
  // what runs the packing gate on it. Both would go quiet without a failure if
  // the enumeration ever narrowed back to `plugins` alone.
  assert.deepEqual(JSON.parse(lines.get("matrix")), {
    include: [
      {
        project: "@yadsh/dsh-cas-results",
        publishable: true,
        directory: "plugins/dsh-cas-results",
      },
      {
        project: "@yadsh/dsh-config",
        publishable: false,
        directory: "",
      },
      {
        project: "@yadsh/dsh-plugin-log",
        publishable: true,
        directory: "packages/plugin-log",
      },
    ],
  });
});

test("the shared card gate rejects a damaged canonical shell", () => {
  const damagedClient = canonicalClient.replace(
    "border-radius:12px",
    "border-radius:10px",
  );

  assert.throws(
    () => verifyPluginCardContract(damagedClient),
    /client bundle must contain canonical shell rule/u,
  );
});

test("the shared card gate rejects font-glyph chevrons", () => {
  assert.throws(
    () => verifyPluginCardContract(`${canonicalClient}\n⌄`),
    /font glyphs must not be used as disclosure chevrons/u,
  );
});

test("the shared card gate forbids our own shell on the Plugins panel row", () => {
  // The maintainer's word of 2026-10-01 (§4.3 option 1): a row card is drawn by the
  // Host, so the class names this gate requires of a settings card are what it
  // rejects here. Pinned in the CI wiring test because the same module is what every
  // package's `verify` target runs.
  assert.doesNotThrow(() => verifyPluginCardContract(rowClient));
  assert.throws(
    () => verifyPluginCardContract(`${rowClient}\n${CANONICAL_SHELL_RULES[0]}`),
    /second frame/u,
  );
});
