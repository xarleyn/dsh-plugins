import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditSource,
  declaredTokens,
  usedTokens,
  verifyDesignTokens,
} from "./verify-design-tokens.mjs";

const DECLARED = declaredTokens(
  `body{--dsw-alias-bg-layer-2:#fff;--dsw-alias-state-error-primary:#ec1313;--dsw-focus-ring-width:2px}`,
);

function messages(source) {
  return auditSource(source, DECLARED).map((finding) => finding.message);
}

test("reads a substitution and nothing else", () => {
  assert.deepEqual(
    usedTokens(
      `a{color:var(--dsw-alias-state-error-primary);background:var( --dsw-alias-bg-layer-2 , red )}`,
    ).map((use) => use.name),
    ["--dsw-alias-state-error-primary", "--dsw-alias-bg-layer-2"],
  );
  // The explanatory wildcard is prose, not a claim about the Host sheet.
  assert.deepEqual(usedTokens("/* a var(--dsw-alias-*) drops the rule */"), []);
  assert.deepEqual(usedTokens("a{color:var(--dsh-local-accent)}"), []);
});

test("reports a name the Host theme does not declare", () => {
  assert.deepEqual(messages("a{background:var(--dsw-alias-bg-error)}"), [
    "--dsw-alias-bg-error is not declared by @deepseek-ai/dsh-client-ui-theme",
  ]);
  assert.deepEqual(messages("a{color:var(--dsw-alias-label-error);}"), [
    "--dsw-alias-label-error is not declared by @deepseek-ai/dsh-client-ui-theme",
  ]);
});

test("reports a dead name even where a fallback keeps the rule alive", () => {
  // The declaration survives, but it paints a colour the Host never chose.
  assert.equal(
    messages("a{color:var(--dsw-alias-border-error, #b3261e)}").length,
    1,
  );
});

test("accepts the names the theme declares", () => {
  assert.deepEqual(
    messages(
      "a{color:var(--dsw-alias-state-error-primary, #b3261e);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);outline:var(--dsw-focus-ring-width, 2px) solid red}",
    ),
    [],
  );
});

async function fixtureWorkspace(css) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-tokens-"));
  const theme = path.join(
    root,
    "node_modules",
    "@deepseek-ai",
    "dsh-client-ui-theme",
  );
  await mkdir(path.join(theme, "lib"), { recursive: true });
  await writeFile(
    path.join(theme, "package.json"),
    JSON.stringify({
      name: "@deepseek-ai/dsh-client-ui-theme",
      version: "1.0.0",
    }),
  );
  await writeFile(
    path.join(theme, "lib", "client.js"),
    "body{--dsw-alias-bg-layer-2:#fff}",
  );
  const plugin = path.join(root, "plugins", "dsh-demo");
  await mkdir(path.join(plugin, "src", "client"), { recursive: true });
  await writeFile(
    path.join(plugin, "package.json"),
    JSON.stringify({
      name: "@yadsh/dsh-demo",
      devDependencies: { "@deepseek-ai/dsh-client-ui-theme": "1.0.0" },
    }),
  );
  await writeFile(
    path.join(plugin, "src", "client", "styles.ts"),
    `export const CSS = "${css}";\n`,
  );
  return root;
}

test("verifies a workspace whose every name the theme declares", async () => {
  const root = await fixtureWorkspace(
    ".x{background:var(--dsw-alias-bg-layer-2)}",
  );
  assert.deepEqual(await verifyDesignTokens({ root }), {
    sources: 1,
    uses: 1,
    declared: 1,
  });
});

test("fails a workspace on the undeclared name it ships", async () => {
  const root = await fixtureWorkspace(
    ".x{background:var(--dsw-alias-bg-error)}",
  );
  await assert.rejects(
    () => verifyDesignTokens({ root }),
    (error) => {
      assert.match(error.message, /design tokens failed/u);
      assert.match(
        error.message,
        /plugins\/dsh-demo\/src\/client\/styles\.ts:1: --dsw-alias-bg-error is not declared/u,
      );
      return true;
    },
  );
});

test("refuses to guess when the theme is not installed", async () => {
  const root = await fixtureWorkspace(".x{color:red}");
  await rm(path.join(root, "node_modules"), { recursive: true, force: true });
  await assert.rejects(
    () => verifyDesignTokens({ root }),
    /but not installed — run pnpm install/u,
  );
});

test("refuses a vocabulary with no package pinning it", async () => {
  const root = await fixtureWorkspace(".x{color:red}");
  await writeFile(
    path.join(root, "plugins", "dsh-demo", "package.json"),
    JSON.stringify({ name: "@yadsh/dsh-demo" }),
  );
  await assert.rejects(
    () => verifyDesignTokens({ root }),
    /no workspace package depends on @deepseek-ai\/dsh-client-ui-theme/u,
  );
});
