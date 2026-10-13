import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJson } from "./test-support/package-hygiene-fixtures.mjs";
import { validateClientContractGates } from "./verify-package-hygiene.mjs";

// ---------------------------------------------------------------------------
// Client contract gates: a dsh.client manifest demands a package-name assert
// in the plugin's scripts, and a card source demands the card-contract gate.
// ---------------------------------------------------------------------------

const clientManifest = { dsh: { client: { platform: "web" } } };

async function pluginFixture({
  manifest = {},
  scriptFiles = {},
  sourceFiles = {},
}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-contract-"));
  const directory = path.join(root, "plugins", "dsh-fixture");
  mkdirSync(directory, { recursive: true });
  const fullManifest = {
    name: "@yadsh/dsh-fixture",
    version: "0.1.0",
    ...manifest,
  };
  writeJson(path.join(directory, "package.json"), fullManifest);
  for (const [name, content] of Object.entries(scriptFiles)) {
    const file = path.join(directory, "scripts", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  for (const [name, content] of Object.entries(sourceFiles)) {
    const file = path.join(directory, "src", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return { root, directory, manifest: fullManifest };
}

test("a client bundle whose scripts never assert the full package name fails", async () => {
  const { root, directory, manifest } = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": 'assert.equal(manifest.name, "dsh-fixture");\n',
    },
  });
  try {
    const errors = validateClientContractGates(directory, manifest);
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /asserts the ModuleLoader registration id "@yadsh\/dsh-fixture"/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a bare package-name mention without a ModuleLoader assert fails", async () => {
  // The reviewer's false-positive: `manifest.name === "@yadsh/dsh-fixture"`
  // mentions the full package name but pins no bundle registration id.
  const { root, directory, manifest } = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs":
        "assert.equal(manifest.name, '@yadsh/dsh-fixture');\n",
    },
  });
  try {
    const errors = validateClientContractGates(directory, manifest);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /ModuleLoader registration id/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("regex-literal and shared-runner asserts of the registration id both pass", async () => {
  const regexForm = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import assert from "node:assert/strict";',
        "",
        "assert.match(",
        "  client,",
        '  /window\\.__ModuleLoader__\\.load\\(\\{\\s*id:\\s*"@yadsh\\/dsh-fixture"/u,',
        ");",
        "",
      ].join("\n"),
    },
  });
  try {
    assert.deepEqual(
      validateClientContractGates(regexForm.directory, regexForm.manifest),
      [],
    );
  } finally {
    await rm(regexForm.root, { recursive: true, force: true });
  }

  const runnerForm = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";',
        "",
        "runVerifyPackage({",
        '  packageName: "@yadsh/dsh-fixture",',
        "  clientBundle: { moduleLoaderId: true },",
        "});",
        "",
      ].join("\n"),
    },
  });
  try {
    assert.deepEqual(
      validateClientContractGates(runnerForm.directory, runnerForm.manifest),
      [],
    );
  } finally {
    await rm(runnerForm.root, { recursive: true, force: true });
  }
});

test("a card source demands a script that runs the card-contract gate", async () => {
  const cardSource = {
    "client/card.tsx": 'renderSlot("settings.plugin.item", Card);\n',
  };
  const withoutGate = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
        "assert.equal(name, '@yadsh/dsh-fixture');",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    const errors = validateClientContractGates(
      withoutGate.directory,
      withoutGate.manifest,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /verify-plugin-card-contract/u);
  } finally {
    await rm(withoutGate.root, { recursive: true, force: true });
  }

  const withGate = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";',
        "",
        "verifyPluginCardContract(bundle);",
        "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
        "assert.equal(name, '@yadsh/dsh-fixture');",
        "",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    assert.deepEqual(
      validateClientContractGates(withGate.directory, withGate.manifest),
      [],
    );
  } finally {
    await rm(withGate.root, { recursive: true, force: true });
  }
});

test("every card slot spelling keeps the card gate armed", async () => {
  const withoutCardGate = [
    "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
    "assert.equal(name, '@yadsh/dsh-fixture');",
  ].join("\n");

  // The Host renamed the settings-card slot, and a card may equally stay on the
  // feature tab, so every spelling a registration arrives under has to arm the
  // gate — otherwise the contract quietly stops being enforced.
  const cardSources = {
    "settings.plugin.item": 'renderSlot("settings.plugin.item", Card);\n',
    "plugins.row.config": 'renderSlot("plugins.row.config", Card);\n',
    "settings.plugins.tab": [
      'import { CardShell } from "@yadsh/dsh-plugin-kit/client";',
      'renderSlot("settings.plugins.tab", CardShell);',
      "",
    ].join("\n"),
  };
  for (const [slot, source] of Object.entries(cardSources)) {
    const fixture = await pluginFixture({
      manifest: clientManifest,
      scriptFiles: { "verify-package.mjs": withoutCardGate },
      sourceFiles: { "client/card.tsx": source },
    });
    try {
      const errors = validateClientContractGates(
        fixture.directory,
        fixture.manifest,
      );
      assert.equal(errors.length, 1, `"${slot}" must demand the card gate`);
      assert.ok(
        errors[0].includes(`"${slot}"`),
        `the error must name the slot it found, got ${errors[0]}`,
      );
      assert.match(errors[0], /verify-plugin-card-contract/u);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }

  // The tab slot is also the home of feature-owned pages that render no card
  // shell at all, and the contract asserts a shell they never claim.
  const featureTab = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: { "verify-package.mjs": withoutCardGate },
    sourceFiles: {
      "client/index.tsx": 'renderSlot("settings.plugins.tab", FeaturePage);\n',
    },
  });
  try {
    assert.deepEqual(
      validateClientContractGates(featureTab.directory, featureTab.manifest),
      [],
    );
  } finally {
    await rm(featureTab.root, { recursive: true, force: true });
  }
});

test("the shared runner's cardContract option satisfies the card gate", async () => {
  const cardSource = {
    "client/card.tsx": 'renderSlot("settings.plugin.item", Card);\n',
  };
  // A manifest leaning on the runner never names the contract module, so the
  // gate has to read the option it passes instead of the import path.
  const runnerForm = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";',
        "",
        "await runVerifyPackage({",
        '  packageName: "@yadsh/dsh-fixture",',
        "  clientBundle: {",
        "    moduleLoaderId: true,",
        "    cardContract: { legacyPatterns: [/.fixture-card{/u] },",
        "  },",
        "});",
        "",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    assert.deepEqual(
      validateClientContractGates(runnerForm.directory, runnerForm.manifest),
      [],
    );
  } finally {
    await rm(runnerForm.root, { recursive: true, force: true });
  }

  // A script that never reaches the runner is still refused.
  const withoutRunner = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        "// cardContract: nothing runs it",
        "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
        "assert.equal(name, '@yadsh/dsh-fixture');",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    const errors = validateClientContractGates(
      withoutRunner.directory,
      withoutRunner.manifest,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /verify-plugin-card-contract/u);
  } finally {
    await rm(withoutRunner.root, { recursive: true, force: true });
  }

  const wrongLevel = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";',
        "await runVerifyPackage({",
        '  packageName: "@yadsh/dsh-fixture",',
        "  clientBundle: { moduleLoaderId: true },",
        "  cardContract: { legacyPatterns: [] },",
        "});",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    const errors = validateClientContractGates(
      wrongLevel.directory,
      wrongLevel.manifest,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /verify-plugin-card-contract/u);
  } finally {
    await rm(wrongLevel.root, { recursive: true, force: true });
  }
});

test("a plugin without a client bundle or card owes neither gate", async () => {
  const { root, directory, manifest } = await pluginFixture({
    scriptFiles: { "verify-package.mjs": "assert.ok(true);\n" },
    sourceFiles: { "index.ts": "export const name = 'dsh-fixture';\n" },
  });
  try {
    assert.deepEqual(validateClientContractGates(directory, manifest), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
