import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// #687: `@yadsh/dsh-plugin-kit`, `@yadsh/dsh-test-kit` and
// `@yadsh/dsh-plugin-generator` failed every one of their test files with
// `[TSCONFIG_ERROR] Failed to load tsconfig 'node_modules/tsconfig.base.json'`.
// Vite 8 lowers TypeScript with the tsconfig `rolldown` resolved, and that
// resolver walks `extends` through the `node_modules/<pkg>` workspace link while
// folding `../` against the link's own location instead of its target. So a preset
// that reaches outside its package — `base.json` reaching the repository root —
// lands outside the tree as soon as a consumer inherits it by package subpath.
// Nothing else sees it: `tsc` canonicalises, so `build`, `typecheck` and the
// shipped bundle stayed green while the suite could not compile, and a POSIX
// resolver folds `..` along the already-resolved path, which is why the mirror run
// was green on the same commit.
//
// So the invariant is the one the transform needs rather than the one `tsc`
// enjoys: read every workspace config through the same un-canonicalised walk and
// require each hop to land on a file. Inheriting a preset by its subpath is fine,
// and a preset escaping its package is fine, but the two together break the suite,
// and only this test can say so before a machine does.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE_GROUPS = ["plugins", "packages", "tooling/generators"];

/** How far a chain may run before it is called circular rather than merely deep. */
const MAX_CHAIN = 10;

/** A hop whose target is not there: the config that asked, and where it landed. */
interface BrokenHop {
  from: string;
  specifier: string;
  landed: string;
}

function relative(target: string): string {
  return path.relative(ROOT, target).split(path.sep).join("/");
}

/** The `extends` values of a config, comments and trailing commas included. */
function extendsOf(file: string): string[] {
  const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
  const value: unknown = parsed.config?.["extends"];
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value as string[];
  }
  throw new Error(`${relative(file)} declares an "extends" that is not a path`);
}

/** Every `tsconfig*.json` a workspace package declares at its own root. */
function packageConfigs(): string[] {
  const found: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = path.join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgDir = path.join(groupDir, entry.name);
      if (!existsSync(path.join(pkgDir, "package.json"))) continue;
      for (const file of readdirSync(pkgDir)) {
        if (/^tsconfig.*\.json$/.test(file))
          found.push(path.join(pkgDir, file));
      }
    }
  }
  return found.sort();
}

/** The first file name a conditional `exports` value names. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return undefined;
  for (const nested of Object.values(value)) {
    const found = firstString(nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Where a package's `exports` map sends a subpath, or `undefined` if it says nothing. */
function exportedFile(pkgDir: string, subpath: string): string | undefined {
  const manifest = path.join(pkgDir, "package.json");
  if (!existsSync(manifest)) return undefined;
  const map: unknown = JSON.parse(readFileSync(manifest, "utf8")).exports;
  if (typeof map === "string")
    return subpath === "." ? path.join(pkgDir, map) : undefined;
  if (typeof map !== "object" || map === null) return undefined;
  const target = firstString((map as Record<string, unknown>)[subpath]);
  return target === undefined ? undefined : path.join(pkgDir, target);
}

/**
 * A bare specifier, resolved the way the transform resolves it: at the nearest
 * `node_modules` entry and kept there, never followed to what the link points at.
 */
function resolveBare(specifier: string, fromDir: string): string | undefined {
  const segments = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const pkg = scoped
    ? `${segments[0] ?? ""}/${segments[1] ?? ""}`
    : (segments[0] ?? "");
  if (!pkg || (scoped && !segments[1])) return undefined;
  const subpath =
    specifier.length > pkg.length
      ? `./${specifier.slice(pkg.length + 1)}`
      : ".";
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const link = path.join(dir, "node_modules", pkg);
    if (existsSync(link)) {
      return (
        exportedFile(link, subpath) ??
        [link, `${link}.json`].find(
          (candidate) => candidate.endsWith(".json") && existsSync(candidate),
        )
      );
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function resolveSpecifier(specifier: string, fromDir: string): string {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    // `path.resolve` folds `..` lexically, which is the walk that breaks under a
    // link; canonicalising first would hide the defect this test exists to catch.
    const target = path.resolve(fromDir, specifier);
    return (
      [target, `${target}.json`].find((candidate) => existsSync(candidate)) ??
      target
    );
  }
  return resolveBare(specifier, fromDir) ?? specifier;
}

/** The first hop of a chain that does not land on a readable config. */
function findBrokenHop(
  entry: string,
  depth = 0,
  seen = new Set<string>(),
): BrokenHop | undefined {
  if (seen.has(entry) || depth > MAX_CHAIN) {
    return {
      from: relative(entry),
      specifier: seen.has(entry) ? "(cycle)" : "(depth)",
      landed: relative(entry),
    };
  }
  seen.add(entry);
  for (const specifier of extendsOf(entry)) {
    const next = resolveSpecifier(specifier, path.dirname(entry));
    if (!existsSync(next)) {
      return { from: relative(entry), specifier, landed: relative(next) };
    }
    const deeper = findBrokenHop(next, depth + 1, new Set(seen));
    if (deeper) return deeper;
  }
  return undefined;
}

describe("workspace tsconfig extends chains", () => {
  const configs = packageConfigs();

  it("covers every package that ships a tsconfig", () => {
    // Guards the guard: a walk that enumerated nothing would pass vacuously.
    expect(configs.length).toBeGreaterThanOrEqual(40);
    expect(configs.map(relative)).toContain(
      "packages/plugin-kit/tsconfig.json",
    );
  });

  it("land every hop on a file, the way Vite's transform reads them", () => {
    const broken = configs
      .map((config) => findBrokenHop(config))
      .filter((hop): hop is BrokenHop => hop !== undefined)
      .map(
        (hop) =>
          `${hop.from} extends "${hop.specifier}" resolves to ${hop.landed}, which is not there — ` +
          `inherit a preset that escapes its package by path, not by package subpath (#687)`,
      );
    expect(broken).toEqual([]);
  });

  it("really break on the shape #687 shipped, so the check above is not vacuous", () => {
    // The preset read through the workspace link is what the resolver does for a
    // package subpath, and `base.json` still escapes its package: the walk has to
    // call that unreadable, or it has stopped modelling the failure it guards.
    const viaLink = path.join(
      ROOT,
      "packages/plugin-kit/node_modules/@yadsh/dsh-config/tsconfig/base.json",
    );
    if (!existsSync(viaLink)) return; // no installed workspace to walk through
    expect(findBrokenHop(viaLink)).toEqual({
      from: relative(viaLink),
      specifier: "../../../tsconfig.base.json",
      landed: "packages/plugin-kit/node_modules/tsconfig.base.json",
    });
  });
});
