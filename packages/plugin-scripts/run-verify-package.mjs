// Shared package gate runner. The per-plugin scripts/verify-package.mjs files
// are thin manifests: they pass the plugin's identity and the expectations the
// package must satisfy, and the checks and error shapes are identical for
// every plugin (guidelines §4, §6.3). Checks unique to one plugin go through
// the `extra` hook, which receives everything the runner already loaded.
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPluginCardContract } from "./verify-plugin-card-contract.mjs";

const CANONICAL_PATCH_HEADER =
  /# The DSH plugin manager discovers this bundle through package\.json\./u;

// The dependency fields a published manifest keeps. `devDependencies` is
// dropped at pack time, so a local protocol there never reaches a consumer.
const PUBLISHED_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
// Every group `pnpm-workspace.yaml` declares, so a `workspace:` reference is
// resolved against the same tree pnpm pack resolves it against.
const WORKSPACE_GROUPS = ["plugins", "packages", "tooling/generators"];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Every file path an `exports` entry promises. Conditional exports may nest
 * `import`/`require`, environment conditions and arrays arbitrarily; each leaf
 * is a public target and must exist in the built package.
 */
function exportTargets(target) {
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.flatMap(exportTargets);
  if (typeof target !== "object" || target === null) return [];
  return Object.values(target).flatMap(exportTargets);
}

/**
 * Manifests of every workspace member, keyed by npm name. The search walks up
 * from the package to the directory owning `pnpm-workspace.yaml`, which is the
 * tree pnpm resolves a `workspace:` reference against at pack time. Returns
 * `undefined` when the package sits outside a workspace.
 */
async function readWorkspaceMembers(packageRoot) {
  let directory = packageRoot;
  for (;;) {
    const workspaceFile = await stat(
      new URL("pnpm-workspace.yaml", directory),
    ).catch(() => undefined);
    if (workspaceFile?.isFile() === true) break;
    const parent = new URL("../", directory);
    if (parent.href === directory.href) return undefined;
    directory = parent;
  }

  const root = fileURLToPath(directory);
  const members = new Map();
  for (const group of WORKSPACE_GROUPS) {
    const entries = await readdir(join(root, group), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(root, group, entry.name, "package.json");
      const manifest = await readFile(manifestPath, "utf8").catch(
        () => undefined,
      );
      if (manifest === undefined) continue;
      const parsed = JSON.parse(manifest);
      if (typeof parsed.name === "string") members.set(parsed.name, parsed);
    }
  }
  return members;
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
 * @param {boolean} [options.mainTypesMatchRootExport] - `main` and `types` must name the file the root export resolves to, so a resolver that ignores `exports` loads the same module.
 * @param {boolean} [options.publishedDependenciesResolve] - Every `dependencies`/`optionalDependencies`/`peerDependencies` entry must carry a range a registry consumer can install: a `workspace:` reference names a member that publishes, a `catalog:` reference names an external package, and a workspace member is never declared as a plain range.
 * @param {"none" | {platform?: string, injectEquals?: string[], injectIncludes?: string[]}} [options.client] - `dsh.client` contract; `"none"` forbids a client surface.
 * @param {string[]} [options.files] - Entries `package.json#files` must publish.
 * @param {string[]} [options.requiredFiles] - Package-relative files that must exist on disk (built artifacts included).
 * @param {{headerComment?: boolean, id: string, name?: string}} [options.patch] - Canonical `cordis.patch.yml` identity.
 * @param {{range?: boolean, testedReleases?: boolean | string[], node?: "nonEmpty" | "matchesEngines", hostFeatures?: string[], clientFeatures?: string[]}} [options.compatibility] - `compatibility.json` contract.
 * @param {{file?: string, moduleLoaderId?: boolean, cardContract?: {seat?: "settings" | "row", legacyPatterns?: RegExp[]}, includes?: string[], matches?: RegExp[], notMatches?: RegExp[]}} [options.clientBundle] - Built browser bundle contract; the bundle text is handed to `extra` as `ctx.client`. `cardContract.seat` picks which card contract the bundle is held to: `"settings"` (default) for a card that draws its own shell, `"row"` for one seated on the Plugins panel row, where the Host draws it and the bundle must not.
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
    mainTypesMatchRootExport = false,
    publishedDependenciesResolve = false,
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

  // `exports` is what a modern resolver reads, and `main`/`types` what an older
  // one falls back to. Two answers for one package is how a consumer ends up
  // loading a file the build stopped writing, so the legacy pair is pinned to
  // the root export here rather than only in the packed tarball.
  if (mainTypesMatchRootExport) {
    const rootExport = manifest.exports?.["."];
    assert.equal(
      manifest.main,
      rootExport?.default,
      'main must name exports["."].default',
    );
    assert.equal(
      manifest.types,
      rootExport?.types,
      'types must name exports["."].types',
    );
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

  // Dependency ranges a consumer can actually install. `workspace:` and
  // `catalog:` are local protocols that pnpm rewrites at pack time, so the
  // packed manifest never shows one and the tarball gate stays quiet — but the
  // rewrite also hides *what the published range points at*. A `workspace:`
  // reference to a private member publishes a dependency that never reaches the
  // registry, and the clean-room install cannot see it because the gate packs
  // the local closure beside the subject; only this source-level read does.
  if (publishedDependenciesResolve) {
    const members = await readWorkspaceMembers(packageRoot);
    assert(
      members !== undefined,
      "publishedDependenciesResolve needs the workspace root (pnpm-workspace.yaml)",
    );
    for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        const member = members.get(dependency);
        const protocol =
          typeof range === "string" && range.includes(":")
            ? range.slice(0, range.indexOf(":"))
            : "";
        if (protocol === "workspace") {
          assert(
            member !== undefined,
            `${field}.${dependency} is a workspace: reference to a name no member publishes`,
          );
          assert.notEqual(
            member.private,
            true,
            `${field}.${dependency} resolves to the private member ${dependency}, which never reaches the registry`,
          );
        } else if (protocol === "catalog") {
          assert(
            member === undefined,
            `${field}.${dependency} names a workspace member through catalog:, which publishes a range the member does not carry`,
          );
        } else {
          assert(
            member === undefined,
            `${field}.${dependency} names a workspace member as a published range; declare it as workspace:^`,
          );
        }
      }
    }
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
