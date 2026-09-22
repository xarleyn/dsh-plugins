// Shared package gate runner. The per-plugin scripts/verify-package.mjs files
// are thin manifests: they pass the plugin's identity and the expectations the
// package must satisfy, and the checks and error shapes are identical for
// every plugin (guidelines §4, §6.3). Checks unique to one plugin go through
// the `extra` hook, which receives everything the runner already loaded.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { verifyPluginCardContract } from "./verify-plugin-card-contract.mjs";

const CANONICAL_PATCH_HEADER =
  /# The DSH plugin manager discovers this bundle through package\.json\./u;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The file paths an `exports` entry promises: a bare string target, or the
 * `types`/`default` conditions of an object target. Conditions the browser
 * resolves differently (`import`/`require`) are not checked separately - the
 * build writes them from the same source.
 */
function exportTargets(target) {
  if (typeof target === "string") return [target];
  return Object.entries(target ?? {})
    .filter(([condition]) => condition === "types" || condition === "default")
    .map(([, path]) => path)
    .filter((path) => typeof path === "string");
}

/**
 * @param {object} options
 * @param {URL | string} options.packageRoot - The plugin package root (the script's `new URL("../", import.meta.url)`).
 * @param {string} options.packageName - Full npm package name, e.g. `@yadsh/dsh-kv-persist`.
 * @param {RegExp} [options.versionPattern] - SemVer shape the version must match (plain releases by default).
 * @param {string} [options.license] - License literal the manifest must declare.
 * @param {boolean} [options.enginesNodeMatchesCompatibility] - Require `engines.node === compatibility.json#node`.
 * @param {boolean} [options.bundlePatch] - Require `dsh.bundle.patch === "./cordis.patch.yml"` (default true).
 * @param {string[]} [options.exports] - Export subpaths that must exist.
 * @param {Record<string, string>} [options.exportDefaults] - Export subpaths whose `default` must equal the given path.
 * @param {boolean} [options.exportsBuilt] - Every export subpath (except `./package.json`) must point at a file that exists on disk.
 * @param {"none" | {platform?: string, injectEquals?: string[], injectIncludes?: string[]}} [options.client] - `dsh.client` contract; `"none"` forbids a client surface.
 * @param {string[]} [options.files] - Entries `package.json#files` must publish.
 * @param {string[]} [options.requiredFiles] - Package-relative files that must exist on disk (built artifacts included).
 * @param {{headerComment?: boolean, id: string, name?: string}} [options.patch] - Canonical `cordis.patch.yml` identity.
 * @param {{range?: boolean, testedReleases?: boolean | string[], node?: "nonEmpty" | "matchesEngines", hostFeatures?: string[], clientFeatures?: string[]}} [options.compatibility] - `compatibility.json` contract.
 * @param {{file?: string, moduleLoaderId?: boolean, cardContract?: {legacyPatterns?: RegExp[]}, includes?: string[], matches?: RegExp[], notMatches?: RegExp[]}} [options.clientBundle] - Built browser bundle contract; the bundle text is handed to `extra` as `ctx.client`.
 * @param {(ctx: {packageRoot: URL, packageDir: string, manifest: object, compatibility: object | undefined, patch: string | undefined, client: string | undefined, readFile: (path: string) => Promise<string>}) => void | Promise<void>} [options.extra] - Plugin-specific checks.
 */
export async function runVerifyPackage(options) {
  const {
    packageName,
    versionPattern = /^\d+\.\d+\.\d+$/u,
    license,
    enginesNodeMatchesCompatibility = false,
    bundlePatch = true,
    exports: exportPaths = [],
    exportDefaults = {},
    exportsBuilt = false,
    client,
    files = [],
    requiredFiles = [],
    patch: patchContract = null,
    compatibility: compatibilityContract = null,
    clientBundle: clientBundleContract = null,
    extra,
  } = options;

  const packageRoot = new URL(options.packageRoot);
  const packageDir = fileURLToPath(packageRoot);
  const readFileFromRoot = (path) =>
    readFile(new URL(path, packageRoot), "utf8");

  const manifest = JSON.parse(await readFileFromRoot("package.json"));

  // Manifest identity.
  assert.equal(manifest.name, packageName);
  assert.match(
    manifest.version,
    versionPattern,
    `version ${manifest.version} is not SemVer`,
  );
  if (license !== undefined) {
    assert.equal(manifest.license, license);
  }

  // Exports: exhaustive public surface.
  for (const exportPath of exportPaths) {
    assert.ok(
      Object.hasOwn(manifest.exports ?? {}, exportPath),
      `package export is missing: ${exportPath}`,
    );
  }
  for (const [exportPath, target] of Object.entries(exportDefaults)) {
    assert.equal(manifest.exports?.[exportPath]?.default, target);
  }

  // A subpath that no build step produces is a promise the package cannot
  // keep, and the packed-tarball gate only catches it in a packing run, so the
  // targets of the public surface are checked against the tree here.
  if (exportsBuilt) {
    for (const [exportPath, target] of Object.entries(manifest.exports ?? {})) {
      if (exportPath === "./package.json") continue;
      for (const path of exportTargets(target)) {
        const entry = await stat(new URL(path, packageRoot)).catch(
          () => undefined,
        );
        assert(
          entry?.isFile() === true,
          `exports["${exportPath}"] must be built: ${path}`,
        );
      }
    }
  }

  // DSH bundle metadata points at the packaged patch.
  if (bundlePatch) {
    assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
  }

  // DSH client surface declaration.
  if (client === "none") {
    assert.equal(manifest.dsh?.client, undefined);
  } else if (client !== undefined) {
    if (client.platform !== undefined) {
      assert.equal(manifest.dsh?.client?.platform, client.platform);
    }
    if (client.injectEquals !== undefined) {
      assert.deepEqual(manifest.dsh?.client?.inject, client.injectEquals);
    }
    for (const injected of client.injectIncludes ?? []) {
      assert.ok(
        manifest.dsh?.client?.inject?.includes(injected),
        `dsh.client.inject must request ${injected}`,
      );
    }
  }

  // Files whitelist.
  for (const required of files) {
    assert.ok(
      manifest.files?.includes(required),
      `files is missing: ${required}`,
    );
  }

  // Canonical bundle patch pair (guidelines §4.3).
  let patch;
  if (patchContract !== null) {
    patch = await readFileFromRoot("cordis.patch.yml");
    if (patchContract.headerComment === true) {
      assert.match(patch, CANONICAL_PATCH_HEADER);
    }
    assert.match(
      patch,
      new RegExp(`id: ${escapeRegExp(patchContract.id)}\\b`, "u"),
    );
    const patchName = patchContract.name ?? packageName;
    assert.match(patch, new RegExp(`name: "${escapeRegExp(patchName)}"`, "u"));
  }

  // Compatibility manifest (guidelines §7).
  let compatibility;
  if (compatibilityContract !== null) {
    compatibility = JSON.parse(await readFileFromRoot("compatibility.json"));
    const harness = compatibility.deepseekHarness;
    if (compatibilityContract.range === true) {
      assert.ok(harness?.range?.length > 0);
    }
    if (compatibilityContract.testedReleases === true) {
      assert.ok(Array.isArray(harness?.testedReleases));
    } else if (Array.isArray(compatibilityContract.testedReleases)) {
      assert.deepEqual(
        harness?.testedReleases,
        compatibilityContract.testedReleases,
      );
    }
    if (compatibilityContract.node === "nonEmpty") {
      assert.ok(compatibility.node?.length > 0);
    } else if (compatibilityContract.node === "matchesEngines") {
      assert.equal(compatibility.node, manifest.engines.node);
    }
    if (enginesNodeMatchesCompatibility) {
      assert.equal(manifest.engines.node, compatibility.node);
    }
    for (const feature of compatibilityContract.hostFeatures ?? []) {
      assert.ok(
        harness?.requiredHostFeatures?.includes(feature),
        `compatibility.json must declare the ${feature} host feature`,
      );
    }
    for (const feature of compatibilityContract.clientFeatures ?? []) {
      assert.ok(
        harness?.requiredClientFeatures?.includes(feature),
        `compatibility.json must declare the ${feature} client feature`,
      );
    }
  } else if (enginesNodeMatchesCompatibility) {
    compatibility = JSON.parse(await readFileFromRoot("compatibility.json"));
    assert.equal(manifest.engines.node, compatibility.node);
  }

  // Built and packaged files must exist on disk.
  for (const path of requiredFiles) {
    const entry = await stat(new URL(path, packageRoot)).catch(() => undefined);
    assert(entry?.isFile() === true, `${path} must be a file`);
  }

  // Built browser bundle contract.
  let clientText;
  if (clientBundleContract !== null) {
    clientText = await readFileFromRoot(
      clientBundleContract.file ?? "lib/client.js",
    );
    if (clientBundleContract.moduleLoaderId === true) {
      assert.match(
        clientText,
        new RegExp(
          `window\\.__ModuleLoader__\\.load\\(\\{\\s*id:\\s*"${escapeRegExp(packageName)}"`,
          "u",
        ),
        `client bundle must register as ${packageName}`,
      );
    }
    for (const needle of clientBundleContract.includes ?? []) {
      assert.ok(
        clientText.includes(needle),
        `client bundle must contain ${needle}`,
      );
    }
    for (const pattern of clientBundleContract.matches ?? []) {
      assert.match(clientText, pattern);
    }
    for (const pattern of clientBundleContract.notMatches ?? []) {
      assert.doesNotMatch(clientText, pattern);
    }
    if (clientBundleContract.cardContract !== undefined) {
      verifyPluginCardContract(clientText, clientBundleContract.cardContract);
    }
  }

  if (extra !== undefined) {
    await extra({
      packageRoot,
      packageDir,
      manifest,
      compatibility,
      patch,
      client: clientText,
      readFile: readFileFromRoot,
    });
  }

  console.log("verify-package: all gates passed");
}
