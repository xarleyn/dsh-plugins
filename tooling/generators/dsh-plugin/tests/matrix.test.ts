/**
 * Real-output matrix for the dsh-plugin generator.
 *
 * The template used to be pinned by string: the assertions matched the exact
 * `build` command and `lib/` was faked on disk, so a scaffolded package that
 * referenced a bundler it never declared, promised a types path no build step
 * wrote, or exported no Cordis entrypoint still passed. This suite instead
 * materialises the generated tree, resolves the toolchain from the dependencies
 * the scaffolded manifest declares, then typechecks, builds, tests and loads the
 * result across the option axes.
 *
 * What a published tarball would contain is not asked of npm here: the scaffold
 * answers it in its own `verify:package` gate, which the `verify` leg below runs
 * against a real build. Packing into a tarball and importing it from a clean
 * install is `pnpm tarball:verify`'s job (see docs/VERIFICATION.md), and a unit
 * test that packs for real inherits a machine instead of a template — it has to
 * find an `npm` and a `tar`, and it waits for both at the mercy of whoever else
 * is on the runner.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import generatePlugin, { type Schema } from "../src/index";

const here = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found above ${start}`);
    }
    dir = parent;
  }
  return dir;
}

const repoRoot = findRepoRoot(here);

/** Installed workspace members, used as the source of resolvable packages. */
const donors = fs
  .readdirSync(path.join(repoRoot, "plugins"))
  .map((entry) => path.join(repoRoot, "plugins", entry))
  .filter((dir) => fs.existsSync(path.join(dir, "node_modules")));

/**
 * Resolve a dependency the way an install would, preferring a workspace member
 * that declared it through the very same catalog, so the scaffold is built
 * against the toolchain versions its own manifest asks for.
 */
function resolveDependency(name: string, spec: string): string {
  let chosen: string | undefined;
  for (const dir of donors) {
    const link = path.join(dir, "node_modules", name);
    if (!fs.existsSync(link)) continue;
    const manifest = readJson(path.join(dir, "package.json")) as {
      devDependencies?: Record<string, string>;
    };
    chosen ??= link;
    if (manifest.devDependencies?.[name] === spec) {
      chosen = link;
      break;
    }
  }
  if (chosen === undefined) {
    throw new Error(
      `${name} is not installed anywhere in this workspace; run ` +
        `'pnpm install --frozen-lockfile' before the matrix suite`,
    );
  }
  return fs.realpathSync(chosen);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

interface Manifest {
  name: string;
  main?: string;
  types?: string;
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function declaredDependencies(manifest: Manifest): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.devDependencies,
  };
}

function exportTargets(target: unknown): string[] {
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) return target.flatMap(exportTargets);
  if (target === null || typeof target !== "object") return [];
  return Object.values(target).flatMap(exportTargets);
}

/**
 * Executables the scaffolded scripts may run, collected only from the
 * dependencies that manifest declares — a command with no declaring dependency
 * is exactly the defect this suite exists to catch.
 */
interface Toolchain {
  binaries: Map<string, string>;
}

function buildToolchain(declared: Record<string, string>): Toolchain {
  const binaries = new Map<string, string>();
  for (const [name, spec] of Object.entries(declared)) {
    let dir: string;
    try {
      dir = resolveDependency(name, spec);
    } catch {
      continue; // an optional dependency of another axis
    }
    const pkg = readJson(path.join(dir, "package.json")) as {
      bin?: string | Record<string, string>;
    };
    const bins =
      typeof pkg.bin === "string" ? { [name]: pkg.bin } : (pkg.bin ?? {});
    for (const [command, file] of Object.entries(bins)) {
      binaries.set(command, path.join(dir, file));
    }
  }
  return { binaries };
}

function spawn(file: string, args: string[], cwd?: string) {
  return spawnSync(file, args, { cwd, encoding: "utf8" });
}

/** Run one `package.json` script as the scaffolded manifest declares it. */
function runScript(
  script: string,
  tools: Toolchain,
  manifest: Manifest,
  cwd: string,
  env: Record<string, string> = {},
): void {
  for (const command of script.split(" && ")) {
    const [program = "", ...args] = command.trim().split(" ");
    if (program === "pnpm" && args[0] === "run") {
      const [nested] = args.slice(1);
      const body = nested === undefined ? undefined : manifest.scripts[nested];
      if (body === undefined) {
        throw new Error(`manifest has no script named ${nested ?? "?"}`);
      }
      runScript(body, tools, manifest, cwd, env);
      continue;
    }

    // A declared dependency provides its command through its own manifest, so
    // an executable the manifest never asked for cannot run at all.
    const binary =
      program === "node" ? process.execPath : tools.binaries.get(program);
    if (binary === undefined) {
      throw new Error(
        `'${program}' (in "${script}") is not provided by any dependency the ` +
          `scaffolded manifest declares`,
      );
    }
    const result = spawnSync(
      process.execPath,
      program === "node" ? args : [binary, ...args],
      { cwd, encoding: "utf8", env: { ...process.env, ...env } },
    );
    if (result.status !== 0) {
      // A command that never started leaves both streams empty, so the reason
      // has to come out of `error` as well; without it a failure reports as a
      // bare command line and no cause.
      throw new Error(
        `command failed: ${command}\n${result.error?.message ?? ""}` +
          `${result.stdout ?? ""}${result.stderr ?? ""}`,
      );
    }
  }
}

const temporaryRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(dir);
  return dir;
}

const scratch = makeTempRoot("dsh-generator-matrix-");

function linkDependencies(into: string, manifest: Manifest): void {
  const nodeModules = path.join(into, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  for (const [name, spec] of Object.entries(declaredDependencies(manifest))) {
    const link = path.join(nodeModules, name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(
      resolveDependency(name, spec),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

interface ScaffoldedVariant {
  label: string;
  pluginId: string;
  options: Schema;
  packageDir: string;
  manifest: Manifest;
  tools: Toolchain;
}

async function scaffold(
  label: string,
  options: Schema,
): Promise<ScaffoldedVariant> {
  const tree = createTreeWithEmptyWorkspace() as Tree;
  tree.write("LICENSE", "MIT License\n");
  await generatePlugin(tree, options);

  const outputRoot = path.join(scratch, label);
  for (const change of tree.listChanges()) {
    if (change.type === "DELETE") continue;
    const content = tree.read(change.path);
    if (content === null) continue;
    const target = path.join(outputRoot, change.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  const pluginName = options.name.replace(/^dsh-/, "");
  const packageDir = path.join(outputRoot, "plugins", `dsh-${pluginName}`);
  const manifest = readJson(path.join(packageDir, "package.json")) as Manifest;
  linkDependencies(packageDir, manifest);
  return {
    label,
    pluginId: `dsh-${pluginName}`,
    options,
    packageDir,
    manifest,
    tools: buildToolchain(declaredDependencies(manifest)),
  };
}

function fakeContext(): unknown {
  const write = () => {};
  return { logger: { debug: write, info: write, warn: write, error: write } };
}

async function importEntrypoint(
  entry: string,
  dshHome: string,
): Promise<Record<string, unknown>> {
  const previous = process.env["DSH_HOME"];
  process.env["DSH_HOME"] = dshHome;
  try {
    return (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  } finally {
    if (previous === undefined) delete process.env["DSH_HOME"];
    else process.env["DSH_HOME"] = previous;
  }
}

/** The scaffold must advertise the script the matrix is about to run. */
function scriptOf(variant: ScaffoldedVariant, name: string): string {
  const script = variant.manifest.scripts[name];
  if (script === undefined) {
    throw new Error(`${variant.label}: package.json has no "${name}" script`);
  }
  return script;
}

describe("generated plugin matrix", { timeout: 600_000 }, () => {
  const variants: ScaffoldedVariant[] = [];

  beforeAll(async () => {
    // Every scaffold imports @yadsh/dsh-plugin-log through its built
    // declarations, and nx builds that package before any dependent target.
    const loggerPackage = path.join(repoRoot, "packages", "plugin-log");
    if (!fs.existsSync(path.join(loggerPackage, "lib", "index.js"))) {
      const tsc = buildToolchain({
        typescript: "catalog:tooling",
      }).binaries.get("tsc");
      const result =
        tsc === undefined
          ? undefined
          : spawn(
              process.execPath,
              [tsc, "-p", "tsconfig.build.json"],
              loggerPackage,
            );
      if (result === undefined || result.status !== 0) {
        throw new Error(
          `@yadsh/dsh-plugin-log could not be built:\n${result?.stderr ?? "typescript is not installed"}`,
        );
      }
    }

    variants.push(await scaffold("host", { name: "matrix-host" }));
    variants.push(
      await scaffold("client", { name: "matrix-client", client: true }),
    );
    variants.push(
      await scaffold("lean", {
        name: "dsh-matrix-lean",
        client: true,
        withTests: false,
        scope: "@example",
      }),
    );
  });

  afterAll(() => {
    for (const dir of temporaryRoots.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("declares a dependency for every tool its scripts run", () => {
    for (const variant of variants) {
      expect(
        variant.tools.binaries.has("tsc"),
        `${variant.label}: no declared dependency provides tsc`,
      ).toBe(true);
      expect(
        variant.tools.binaries.has("tsdown"),
        `${variant.label}: tsdown availability`,
      ).toBe(variant.options.client === true);
    }
  });

  it("typechecks the sources it ships", () => {
    for (const variant of variants) {
      runScript(
        scriptOf(variant, "typecheck"),
        variant.tools,
        variant.manifest,
        variant.packageDir,
      );
    }
  });

  it("builds every path the public surface promises", () => {
    for (const variant of variants) {
      runScript(
        scriptOf(variant, "build"),
        variant.tools,
        variant.manifest,
        variant.packageDir,
      );
      for (const [subpath, target] of Object.entries(
        variant.manifest.exports,
      )) {
        if (subpath === "./package.json") continue;
        for (const file of exportTargets(target)) {
          expect(
            fs.existsSync(path.join(variant.packageDir, file)),
            `${variant.label}: exports["${subpath}"] is not built: ${file}`,
          ).toBe(true);
        }
      }
    }
  });

  it("applies the built host entrypoint as a Cordis plugin", async () => {
    for (const variant of variants) {
      const module = await importEntrypoint(
        path.join(variant.packageDir, "lib", "index.js"),
        makeTempRoot("dsh-generator-home-"),
      );
      expect(module.name).toBe(variant.pluginId);
      expect(module.inject).toEqual([]);
      expect(module.apply).toBeTypeOf("function");
      const dispose = (
        module.apply as (ctx: unknown, config: unknown) => () => Promise<void>
      )(fakeContext(), {});
      await expect(dispose()).resolves.toBeUndefined();
    }
  });

  it("passes the package gates against a real build", () => {
    for (const variant of variants) {
      runScript(
        scriptOf(variant, "verify"),
        variant.tools,
        variant.manifest,
        variant.packageDir,
      );
    }
  });

  it("ships a browser bundle that registers the full package name", () => {
    for (const variant of variants) {
      const bundle = path.join(variant.packageDir, "lib", "client.js");
      if (variant.options.client !== true) {
        expect(fs.existsSync(bundle), variant.label).toBe(false);
        continue;
      }
      // The bundler reprints the banner, so match the registration contract
      // rather than the one-line form the template writes.
      const client = fs.readFileSync(bundle, "utf8");
      expect(client, `${variant.label}: ModuleLoader registration`).toContain(
        `id: ${JSON.stringify(variant.manifest.name)}`,
      );
      expect(client).toContain("window.__ModuleLoader__.load(");
      expect(client).not.toMatch(/^\s*export\s/mu);
    }
  });

  it("runs the scaffolded test suite", () => {
    for (const variant of variants) {
      if (variant.options.withTests === false) {
        expect(variant.manifest.scripts["test"], variant.label).toBeUndefined();
        continue;
      }
      runScript(
        scriptOf(variant, "test"),
        variant.tools,
        variant.manifest,
        variant.packageDir,
      );
    }
  });
});
