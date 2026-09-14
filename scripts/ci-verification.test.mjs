import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CANONICAL_SHELL_RULES,
  verifyPluginCardContract,
} from "./verify-plugin-card-contract.mjs";

const canonicalClient = [
  ...CANONICAL_SHELL_RULES,
  '<path d="m3.5 5.25 3.5 3.5 3.5-3.5"/>',
].join("\n");

test("the PR workflow fans affected projects out into a bounded matrix", async () => {
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
    /DSH_PROJECTS_JSON="\$affected_json" node scripts\/workspace-packages\.mjs --format=github-matrix/u,
  );
  assert.match(
    workflow,
    /concurrency:\s+group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s+cancel-in-progress: true/u,
  );
  assert.match(workflow, /max-parallel: 6/u);
  assert.match(
    workflow,
    /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.matrix\) \}\}/u,
  );
  assert.match(
    workflow,
    /NX_PROJECT: \$\{\{ matrix\.project \}\}\s+run: pnpm nx run-many -t lint typecheck test build verify --projects="\$NX_PROJECT" --output-style=static/u,
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
    /- name: Check version plans\s+if: github\.event_name == 'pull_request'\s+run: pnpm release:check --base="\$NX_BASE" --head="\$NX_HEAD"/u,
  );
  assert.ok(
    workflow.indexOf("- name: Check version plans") <
      workflow.indexOf("- name: Select affected projects"),
    "the version plan check must run before the affected projects are selected",
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
  assert.match(workflow, /name: Verify affected projects\s+if: always\(\)/u);
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

test("the CI matrix marks only publishable projects for tarball verification", () => {
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

  assert.equal(lines.get("count"), "2");
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
