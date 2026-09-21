import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CATALOG_HEADER,
  MANIFEST_FILE,
  PRIVATE_PACKAGE_LABEL,
  README_FILE,
  SCHEMA_FILE,
  buildManifest,
  collectCatalogEntries,
  findManifestDrift,
  findManifestSchemaErrors,
  findReadmeDrift,
  renderCatalogTable,
  renderReadmeCatalog,
  schemaErrorsFor,
  serializeManifest,
} from "./generate-plugins-manifest.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function writePackage(root, directory, manifest) {
  const packageRoot = path.join(root, ...directory.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-plugins-catalog-"));
  writePackage(root, "plugins/dsh-alpha", {
    name: "@yadsh/dsh-alpha",
    description: "Alpha plugin",
    homepage: "https://example.invalid/plugins/dsh-alpha",
    keywords: ["deepseek-harness", "dsh"],
  });
  writePackage(root, "plugins/dsh-private", {
    name: "@yadsh/dsh-private",
    description: "Private plugin",
    private: true,
  });
  writePackage(root, "packages/config", {
    name: "@yadsh/dsh-config",
    description: "Shared\nconfiguration",
    private: true,
  });
  return root;
}

test("the committed manifest and README catalog are up to date", () => {
  assert.deepEqual(findManifestDrift(repoRoot), []);
  assert.deepEqual(findReadmeDrift(repoRoot), []);
  assert.ok(
    readFileSync(path.join(repoRoot, MANIFEST_FILE), "utf8").length > 0,
  );
});

test("the committed manifest matches docs/plugins.schema.json", () => {
  assert.deepEqual(findManifestSchemaErrors(repoRoot), []);
});

test("the generator writes a manifest the schema accepts", () => {
  const root = fixtureRepo();
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(
    path.join(root, SCHEMA_FILE),
    readFileSync(path.join(repoRoot, SCHEMA_FILE)),
  );
  writeFileSync(
    path.join(root, MANIFEST_FILE),
    serializeManifest(buildManifest(root)),
  );

  assert.deepEqual(findManifestSchemaErrors(root), []);
});

test("a structurally invalid manifest reports its schema path", () => {
  const root = fixtureRepo();
  mkdirSync(path.join(root, "docs"), { recursive: true });
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, SCHEMA_FILE), "utf8"),
  );
  writeFileSync(path.join(root, SCHEMA_FILE), JSON.stringify(schema));

  const manifest = buildManifest(root);
  manifest.plugins[0].client = "yes";
  delete manifest.plugins[0].homepage;
  manifest.plugins[0].extra = true;
  assert.deepEqual(schemaErrorsFor(manifest, schema), [
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].homepage: missing required property",
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].client: expected boolean, received string",
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].extra: unexpected property",
  ]);

  writeFileSync(path.join(root, MANIFEST_FILE), serializeManifest(manifest));
  assert.deepEqual(findManifestSchemaErrors(root), [
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].homepage: missing required property",
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].client: expected boolean, received string",
    `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ` +
      "$.plugins[0].extra: unexpected property",
  ]);
});

test("the generator refuses to write a schema-invalid catalog", () => {
  const root = fixtureRepo();
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(
    path.join(root, SCHEMA_FILE),
    readFileSync(path.join(repoRoot, SCHEMA_FILE)),
  );
  const publicManifest = path.join(root, "plugins/dsh-alpha/package.json");
  const pkg = JSON.parse(readFileSync(publicManifest, "utf8"));
  delete pkg.homepage;
  writeFileSync(publicManifest, JSON.stringify(pkg, null, 2));

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, "scripts/generate-plugins-manifest.mjs")],
        { cwd: root },
      ),
    (error) =>
      error.status === 1 && /was not written/u.test(String(error.stderr)),
  );
  assert.equal(existsSync(path.join(root, MANIFEST_FILE)), false);
});

test("the README catalog documents private packages the manifest skips", () => {
  const root = fixtureRepo();
  const entries = collectCatalogEntries(root);

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["plugins/dsh-alpha", "plugins/dsh-private", "packages/config"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.npm),
    ["@yadsh/dsh-alpha", null, null],
  );
  assert.deepEqual(
    buildManifest(root).plugins.map((plugin) => plugin.path),
    ["plugins/dsh-alpha"],
  );
});

test("the rendered table marks private packages and normalizes cells", () => {
  const table = renderCatalogTable(collectCatalogEntries(fixtureRepo()));

  assert.equal(table.split("\n")[0], CATALOG_HEADER);
  assert.match(
    table,
    /^\| `plugins\/dsh-alpha` \| `@yadsh\/dsh-alpha` \| Alpha plugin \|$/mu,
  );
  assert.match(
    table,
    new RegExp(
      `^\\| \`packages/config\` \\| ${PRIVATE_PACKAGE_LABEL} \\| Shared configuration \\|$`,
      "mu",
    ),
  );
  assert.ok(!table.includes("Shared\nconfiguration"));
});

test("rendering the README replaces only the catalog table", () => {
  const root = fixtureRepo();
  const entries = collectCatalogEntries(root);
  const readme = [
    "# Plugins",
    "",
    "Prose before the table.",
    "",
    CATALOG_HEADER,
    "| --- | --- | --- |",
    "| `plugins/dsh-stale` | `@yadsh/dsh-stale` | Stale plugin |",
    "",
    "Prose after the table.",
    "",
  ].join("\n");

  const rendered = renderReadmeCatalog(readme, entries);
  assert.ok(rendered.includes("Prose before the table."));
  assert.ok(rendered.includes("Prose after the table."));
  assert.ok(!rendered.includes("dsh-stale"));
  assert.ok(rendered.includes("`plugins/dsh-alpha`"));
  assert.equal(renderReadmeCatalog(rendered, entries), rendered);
});

test("a missing table is reported instead of silently passing", () => {
  const root = fixtureRepo();
  const readme = "# Plugins\n\nNo catalog here.\n";
  writeFileSync(path.join(root, README_FILE), readme);

  assert.equal(renderReadmeCatalog(readme, collectCatalogEntries(root)), null);
  assert.deepEqual(findReadmeDrift(root), [
    `${README_FILE} is missing the ${JSON.stringify(CATALOG_HEADER)} ` +
      `package table followed by "| --- | --- | --- |"`,
  ]);
});

test("a stale row is reported as README drift", () => {
  const root = fixtureRepo();
  const readme = renderReadmeCatalog(
    [
      "# Plugins",
      "",
      CATALOG_HEADER,
      "| --- | --- | --- |",
      "| `plugins/dsh-alpha` | `@yadsh/dsh-alpha` | Alpha plugin |",
      "",
    ].join("\n"),
    collectCatalogEntries(root),
  );
  writeFileSync(path.join(root, README_FILE), readme);

  assert.deepEqual(findReadmeDrift(root), []);
  writeFileSync(
    path.join(root, README_FILE),
    readme.replace("| Alpha plugin |", "| Alpha plugin renamed |"),
  );
  assert.deepEqual(findReadmeDrift(root), [
    `${README_FILE} package catalog is out of date with the workspace ` +
      'manifests; run "pnpm plugins:manifest"',
  ]);
});
