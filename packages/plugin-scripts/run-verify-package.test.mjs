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
  // The seat is part of the contract: the gate reads the card's chrome obligation
  // off the registration the bundle actually carries.
  'slots.register({ name: "settings.plugins.tab" }, FixtureCard);',
  ...CANONICAL_SHELL_RULES,
  '<path d="m3.5 5.25 3.5 3.5 3.5-3.5"/>',
  // The stylesheet above only says the shell is styled. The contract also reads
  // the two strings only the code that *renders* the shell can produce.
  'const card = open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card";',
  'jsx("button", { className: "dsh-plugin-card__header", "aria-expanded": open });',
  'window.__ModuleLoader__.load({ id: "@yadsh/dsh-fixture"',
].join("\n");

/** A card seated on the Plugins panel row: the Host draws its frame. */
const rowClient = [
  'slots.register({ name: "plugins.row.config", key: "@yadsh/dsh-fixture#fixture" }, RowCard);',
  'const RowCard = () => jsx("section", { className: "fixture-body" });',
  // The ring of a row card comes from the Host's tokens; with no focus rule at all the
  // card has lost the indicator, which is the failure this half of the gate exists for.
  ".fixture-body button:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))}",
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
          range: ">=0.1.7-rc.2 <0.2.0",
          testedReleases: ["0.1.7-rc.2"],
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

/**
 * A workspace root carrying one publishable and one private member, so the
 * published-range gate resolves a `workspace:` reference against the same tree
 * pnpm pack resolves it against. Returns the directory of the subject package.
 */
async function writeWorkspace(name) {
  const root = join(globalThis.fixtureRoot, name);
  await mkdir(join(root, "packages"), { recursive: true });
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  for (const member of [
    { name: "@yadsh/dsh-public-helper", version: "1.0.0" },
    { name: "@yadsh/dsh-private-helper", version: "1.0.0", private: true },
  ]) {
    const directory = join(root, "packages", member.name.split("/").pop());
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(member, null, 2)}\n`,
    );
  }
  return join(root, "packages", "subject");
}

test("main and types are pinned to the root export", async () => {
  const directory = join(globalThis.fixtureRoot, "main-types");
  const rootExport = { types: "./lib-index.d.ts", default: "./lib-index.js" };
  const fields = (main, types) => ({
    main,
    types,
    exports: { ".": rootExport, "./package.json": "./package.json" },
  });
  const gate = () =>
    runVerifyPackage(
      baseOptions(directory, { mainTypesMatchRootExport: true }),
    );

  await writeFixture(directory, {
    manifest: fields("./lib-index.js", "./lib-index.d.ts"),
  });
  await gate();

  // A legacy field a rename left behind names a file nothing builds, and only a
  // resolver that ignores `exports` loads it — which is why it fails here rather
  // than in the packing gate.
  await writeFixture(directory, {
    manifest: fields("./lib/legacy.js", "./lib-index.d.ts"),
  });
  await assert.rejects(gate(), /main must name exports/u);

  await writeFixture(directory, {
    manifest: fields("./lib-index.js", "./lib/legacy.d.ts"),
  });
  await assert.rejects(gate(), /types must name exports/u);
});

test("a published dependency range resolves for a registry consumer", async () => {
  const directory = await writeWorkspace("published-ranges");
  const gate = async (manifest) => {
    await writeFixture(directory, { manifest });
    return runVerifyPackage(
      baseOptions(directory, { publishedDependenciesResolve: true }),
    );
  };

  // A member declared through the local protocol, an external package named by
  // a catalog, and an external plain range all install from the registry.
  await gate({
    dependencies: {
      "@yadsh/dsh-public-helper": "workspace:^",
      "@deepseek-ai/cordis": "catalog:dsh",
      pino: "^10.3.1",
    },
    // `devDependencies` never reaches the tarball, so a private member there is
    // the workspace's own business.
    devDependencies: { "@yadsh/dsh-private-helper": "workspace:^" },
  });

  // The pack step rewrites each of these into a range that looks installable, so
  // only this source-level read sees what it pointed at.
  await assert.rejects(
    gate({ dependencies: { "@yadsh/dsh-private-helper": "workspace:^" } }),
    /resolves to the private member/u,
  );
  await assert.rejects(
    gate({ dependencies: { "@yadsh/dsh-absent-helper": "workspace:^" } }),
    /no member publishes/u,
  );
  await assert.rejects(
    gate({ dependencies: { "@yadsh/dsh-public-helper": "catalog:dsh" } }),
    /names a workspace member through catalog:/u,
  );
  await assert.rejects(
    gate({ dependencies: { "@yadsh/dsh-public-helper": "^1.0.0" } }),
    /declare it as workspace:\^/u,
  );
});

test("the range gate needs the package to sit in a workspace", async () => {
  const directory = join(globalThis.fixtureRoot, "published-ranges-outside");
  await writeFixture(directory);
  await assert.rejects(
    runVerifyPackage(
      baseOptions(directory, { publishedDependenciesResolve: true }),
    ),
    /needs the workspace root/u,
  );
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

test("nested import, require and array export targets are all checked", async () => {
  const directory = join(globalThis.fixtureRoot, "exports-conditional");
  await writeFixture(directory, {
    manifest: {
      exports: {
        ".": {
          types: "./lib-index.d.ts",
          node: {
            import: "./lib-index.js",
            require: ["./lib-index.cjs", "./lib-index-fallback.cjs"],
          },
        },
        "./package.json": "./package.json",
      },
    },
  });
  await writeFile(join(directory, "lib-index.d.ts"), "export {};\n");
  await writeFile(join(directory, "lib-index.cjs"), "module.exports = {};\n");
  const options = baseOptions(directory, { exportsBuilt: true });

  await assert.rejects(
    runVerifyPackage(options),
    /must be built: \.\/lib-index-fallback\.cjs/u,
  );
  await writeFile(
    join(directory, "lib-index-fallback.cjs"),
    "module.exports = {};\n",
  );
  await runVerifyPackage(options);
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

  // The same gate, seated on the panel row: no shell of ours is wanted there, and
  // one is what fails it.
  await writeFixture(directory, { clientBundle: rowClient });
  await runVerifyPackage(
    baseOptions(directory, {
      clientBundle: {
        file: "lib-client.js",
        moduleLoaderId: true,
        cardContract: {},
      },
    }),
  );
  await writeFixture(directory, {
    clientBundle: `${rowClient}\n${CANONICAL_SHELL_RULES[0]}`,
  });
  await assert.rejects(
    runVerifyPackage(
      baseOptions(directory, {
        clientBundle: {
          file: "lib-client.js",
          moduleLoaderId: true,
          cardContract: {},
        },
      }),
    ),
    /second frame/u,
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
