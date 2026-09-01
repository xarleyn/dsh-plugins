import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CANONICAL_SHELL_RULES,
  verifyPluginCardContract,
} from "./verify-plugin-card-contract.mjs";

const canonicalClient = [
  ...CANONICAL_SHELL_RULES,
  '<path d="m3.5 5.25 3.5 3.5 3.5-3.5"/>',
].join("\n");

test("the PR workflow runs affected and repository package verification", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /pnpm nx affected -t lint typecheck test build verify --base="\$NX_BASE" --head="\$NX_HEAD"/u,
  );
  assert.match(workflow, /- name: Verify plugin logging contract\s+run: pnpm verify:logging/u);
  assert.match(
    workflow,
    /- name: Verify publishable plugin package hygiene\s+run: pnpm verify:packages/u,
  );
  assert.ok(
    workflow.indexOf("- name: Verify affected projects") <
      workflow.indexOf("- name: Verify affected tarballs"),
    "package verification must run before affected tarball verification",
  );
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
