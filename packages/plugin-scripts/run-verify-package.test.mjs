// Regression tests for the shared package gate runner. The per-plugin
// verify-package.mjs manifests lean on it, so the staged checks have to keep
// their exact accept/reject behaviour; a fixture package exercises the
// manifest, patch, compatibility, client, bundle, and `extra` surfaces.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { runVerifyPackage } from "./run-verify-package.mjs";
import { CANONICAL_SHELL_RULES } from "./verify-plugin-card-contract.mjs";

const PATCH = `# The DSH plugin manager discovers this bundle through package.json.
- insert:
    - id: dsh-fixture
      name: "@yadsh/dsh-fixture"
`;

const canonicalClient = [
  ...CANONICAL_SHELL_RULES,
  '<path d="m3.5 5.25 3.5 3.5 3.5-3.5"/>',
  'window.__ModuleLoader__.load({ id: "@yadsh/dsh-fixture"',
].join("\n");

async function writeFixture(directory, overrides = {}) {
  await mkdir(directory, { recursive: true });
  const manifest = {
    name: "@yadsh/dsh-fixture",
    version: "1.2.3",
    license: "MIT",
    engines: { node: "^22.19.0 || >=24.0.0" },
    exports: {
      ".": "./lib-index.js",
      "./package.json": "./package.json",
    },
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    files: ["lib", "cordis.patch.yml", "compatibility.json"],
    ...overrides.manifest,
  };
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    join(directory, "cordis.patch.yml"),
    overrides.patch ?? PATCH,
  );
  await writeFile(
    join(directory, "compatibility.json"),
    JSON.stringify(
      overrides.compatibility ?? {
        deepseekHarness: {
          range: ">=0.1.5-rc.2 <0.2.0",
          testedReleases: ["0.1.5-rc.2"],
          requiredHostFeatures: ["tools/register"],
        },
        node: "^22.19.0 || >=24.0.0",
      },
    ),
  );
  await writeFile(join(directory, "lib-index.js"), "export default {};\n");
  if (overrides.clientBundle !== undefined) {
    await writeFile(join(directory, "lib-client.js"), overrides.clientBundle);
  }
}

/** Base options that match the fixture written by `writeFixture`. */
function baseOptions(directory, overrides = {}) {
  return {
    packageRoot: pathToFileURL(join(directory, "/")),
    packageName: "@yadsh/dsh-fixture",
    license: "MIT",
    enginesNodeMatchesCompatibility: true,
    exports: [".", "./package.json"],
    client: "none",
    files: ["lib", "cordis.patch.yml", "compatibility.json"],
    patch: { headerComment: true, id: "dsh-fixture" },
    compatibility: {
      range: true,
      testedReleases: true,
      node: "matchesEngines",
      hostFeatures: ["tools/register"],
    },
    requiredFiles: ["lib-index.js"],
    ...overrides,
  };
}

before(async () => {
  globalThis.fixtureRoot = await mkdtemp(join(tmpdir(), "dsh-plugin-scripts-"));
});

after(async () => {
  await rm(globalThis.fixtureRoot, { recursive: true, force: true });
});
test("a conforming package passes every staged gate", async () => {
  const directory = join(globalThis.fixtureRoot, "happy");
  await writeFixture(directory);
  await runVerifyPackage(baseOptions(directory));
});

test("a missing built file fails the gate", async () => {
  const directory = join(globalThis.fixtureRoot, "missing-file");
  await writeFixture(directory);
  rm(join(directory, "lib-index.js"));
  await assert.rejects(
    runVerifyPackage(baseOptions(directory)),
    /lib-index\.js must be a file/u,
  );
});

test("an export subpath pointing at nothing fails the gate", async () => {
  const directory = join(globalThis.fixtureRoot, "exports-built");
  await writeFixture(directory, {
    manifest: {
      exports: {
        ".": { types: "./lib-index.d.ts", default: "./lib-index.js" },
        "./package.json": "./package.json",
      },
    },
  });
  const options = baseOptions(directory, { exportsBuilt: true });
  // A declaration file the build never wrote is a surface the tarball cannot
  // serve, so the subpath is refused...
  await assert.rejects(
    runVerifyPackage(options),
    /exports\["\."\] must be built: \.\/lib-index\.d\.ts/u,
  );
  // ...and accepted once every condition of the entry is on disk.
  await writeFile(join(directory, "lib-index.d.ts"), "export {};\n");
  await runVerifyPackage(options);
});

test("a bare-string export target is checked as well", async () => {
  const directory = join(globalThis.fixtureRoot, "exports-string");
  await writeFixture(directory, {
    manifest: {
      exports: {
        ".": "./lib-index.js",
        "./styles.css": "./lib/styles.css",
        "./package.json": "./package.json",
      },
    },
  });
  await assert.rejects(
    runVerifyPackage(
      baseOptions(directory, {
        exports: [".", "./styles.css", "./package.json"],
        exportsBuilt: true,
      }),
    ),
    /exports\["\.\/styles\.css"\] must be built: \.\/lib\/styles\.css/u,
  );
});

test("a drifting bundle patch identity fails the gate", async () => {
  const directory = join(globalThis.fixtureRoot, "patch-drift");
  await writeFixture(directory, {
    patch: PATCH.replace("id: dsh-fixture", "id: dsh-impostor"),
  });
  await assert.rejects(
    runVerifyPackage(baseOptions(directory)),
    /did not match/u,
  );
});

test("an unexpected client surface fails the gate", async () => {
  const directory = join(globalThis.fixtureRoot, "client-drift");
  await writeFixture(directory, {
    manifest: {
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
    },
  });
  await assert.rejects(
    runVerifyPackage(baseOptions(directory)),
    /Expected values to be strictly equal/u,
  );
});

test("a prerelease version passes when the pattern allows it", async () => {
  const directory = join(globalThis.fixtureRoot, "prerelease");
  await writeFixture(directory, { manifest: { version: "1.2.3-rc.1" } });
  await runVerifyPackage(
    baseOptions(directory, {
      versionPattern: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
    }),
  );
  await assert.rejects(
    runVerifyPackage(baseOptions(directory)),
    /is not SemVer/u,
  );
});

test("the client bundle gate runs the canonical card contract", async () => {
  const directory = join(globalThis.fixtureRoot, "card");
  await writeFixture(directory, { clientBundle: canonicalClient });
  await runVerifyPackage(
    baseOptions(directory, {
      clientBundle: {
        file: "lib-client.js",
        moduleLoaderId: true,
        cardContract: { legacyPatterns: [/\.fixture-card\{/u] },
      },
    }),
  );
  // A font-glyph chevron is rejected by the shared contract.
  await writeFixture(directory, {
    clientBundle: `${canonicalClient}\n\u2304`,
  });
  await assert.rejects(
    runVerifyPackage(
      baseOptions(directory, {
        clientBundle: {
          file: "lib-client.js",
          moduleLoaderId: true,
          cardContract: { legacyPatterns: [] },
        },
      }),
    ),
    /font glyphs must not be used/u,
  );
});

test("the extra hook receives the loaded artifacts", async () => {
  const directory = join(globalThis.fixtureRoot, "extra");
  await writeFixture(directory);
  let seen;
  await runVerifyPackage(
    baseOptions(directory, {
      extra: async ({ manifest, patch, client, readFile }) => {
        seen = {
          name: manifest.name,
          patch: patch.includes("id: dsh-fixture"),
          client,
          docs: await readFile("lib-index.js"),
        };
      },
    }),
  );
  assert.equal(seen.name, "@yadsh/dsh-fixture");
  assert.equal(seen.patch, true);
  assert.equal(seen.client, undefined);
  assert.match(seen.docs, /export default/u);
});
