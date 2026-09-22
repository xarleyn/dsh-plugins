/**
 * Package gate for @yadsh/dsh-documents.
 *
 * The manifest, patch, export, file, bundle-registration and card-shell checks
 * come from @yadsh/dsh-plugin-scripts/run-verify-package. What is left below is
 * what only this package can promise: the built host entry installs the
 * subsystem and publishes the in-process face, the comparison tools and the
 * skill ship with it, and every module under `comparison/` stays in-process.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

const root = new URL("../", import.meta.url);

await runVerifyPackage({
  packageRoot: root,
  packageName: "@yadsh/dsh-documents",
  license: "MIT",
  exports: [".", "./client", "./types", "./package.json"],
  exportsBuilt: true,
  client: { platform: "web" },
  files: [
    "skills",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/client.js",
    "lib/types/index.d.ts",
    "lib/types/client/index.d.ts",
    "cordis.patch.yml",
  ],
  patch: { id: "documents", name: "@yadsh/dsh-documents" },
  compatibility: {
    range: true,
    testedReleases: true,
    node: "matchesEngines",
  },
  clientBundle: {
    moduleLoaderId: true,
    // A card registers into the shared slot through the declared client
    // services.
    matches: [/const inject = \[[^\]]*"settingsScope"[^\]]*\]/u],
    // The browser has no module table for Node builtins: one `require("node:…")`
    // left in the bundle is a card that never mounts.
    notMatches: [
      /require\("node:(?:path|fs|fs\/promises|zlib|os|child_process)"\)/u,
    ],
    cardContract: {
      legacyPatterns: [/\.dsh-docs-card\{/u, /\.dsh-plugin-card \*/u],
    },
  },
  extra: async ({ readFile: readFromRoot }) => {
    // Host entry: the pipeline installs itself, the five semantic tools and the
    // comparison pair come from it, and the skill ships with it.
    const entry = await readFromRoot("lib/index.js");
    assert.match(entry, /installDocumentSubsystem/u);
    assert.match(entry, /DOCUMENT_TOOL_NAMES/u);
    assert.match(entry, /mountDocumentSkills/u);
    // The in-process face sibling host plugins convert through (no Remote: the
    // name is published with ctx.provide and looked up by string).
    assert.match(entry, /provide\("documents"/u);
    assert.match(entry, /toMarkdown/u);
    assert.match(entry, /convert/u);
    // The package builds per module, so the comparison tools live beside the
    // others and each one declares its own name.
    assert.match(
      await readFromRoot("lib/documents/tools/compare.js"),
      /document_compare/u,
    );
    assert.match(
      await readFromRoot("lib/documents/tools/diff-read.js"),
      /document_diff_read/u,
    );

    const skill = await readFromRoot("skills/contract-review/SKILL.md");
    assert.match(skill, /^---\r?\nname: contract-review$/mu);
    assert.match(
      skill,
      /^allowed-tools: document_inspect document_compare document_diff_read$/mu,
    );

    // The comparison runs in-process. A module under `comparison/` that could
    // reach a process or a socket would break the one promise the feature is
    // built on, so the imports are checked at the source rather than trusted.
    const comparisonFiles = await sourceFiles(
      new URL("src/documents/comparison/", root),
    );
    assert(
      comparisonFiles.length > 10,
      "the comparison sources must be present",
    );
    for (const file of comparisonFiles) {
      const text = await readFile(file, "utf8");
      for (const forbidden of [
        "child_process",
        "spawnSync",
        "execFile",
        "node:net",
        "node:http",
        "node:https",
        "node:worker_threads",
      ]) {
        assert.equal(
          text.includes(forbidden),
          false,
          `${file.pathname} must not reach ${forbidden}`,
        );
      }
    }
  },
});

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory()) found.push(...(await sourceFiles(child)));
    else if (entry.name.endsWith(".ts")) found.push(child);
  }
  return found;
}
