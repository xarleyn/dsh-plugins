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
//
// What this tree measures rather than infers: the defect is the combination, not
// the subpath. `node` and `client` are inherited by subpath across the tree and
// their suites run, because neither declares an `extends` for a link to mis-place;
// inheriting `base` by subpath did not run, and the two escaping presets are out of
// the package's `exports` now, so a stale `extends` fails to resolve on every
// platform instead of pairing a green `tsc` with a red suite. The cases below keep
// both halves of that difference.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE_GROUPS = ["plugins", "packages", "tooling/generators"];

/** The package that ships the presets, read at its real path. */
const CONFIG_PKG = path.join(ROOT, "packages/config");

/** How far a chain may run before it is called circular rather than merely deep. */
const MAX_CHAIN = 10;

/** A hop whose target is not there: the config that asked, and where it landed. */
interface BrokenHop {
  from: string;
  specifier: string;
  landed: string;
}

/**
 * A path TypeScript's config parser takes. Given a Windows-separator file name it
 * asserts inside `parseJsonText` on its way to reporting a diagnostic, so the
 * message about the config that does not parse never arrives.
 */
function parserPath(target: string): string {
  return target.split(path.sep).join("/");
}

function relative(target: string): string {
  return parserPath(path.relative(ROOT, target));
}

/** The `extends` values of a config, comments and trailing commas included. */
function extendsOf(file: string): string[] {
  const parsed = ts.parseConfigFileTextToJson(
    parserPath(file),
    readFileSync(file, "utf8"),
  );
  if (parsed.error) {
    // A config that does not parse still yields a `config`, an empty one. Reading
    // only that side of the result would call the file preset-less and walk past it,
    // which is exactly the config the walk needs to look at.
    throw new Error(
      `${relative(file)} does not parse: ${ts.flattenDiagnosticMessageText(
        parsed.error.messageText,
        " ",
      )}`,
    );
  }
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

/** Every subpath a package's `exports` map names, with the file it sends to. */
function exportedSubpaths(pkgDir: string): { subpath: string; file: string }[] {
  const manifest = path.join(pkgDir, "package.json");
  if (!existsSync(manifest)) return [];
  const map: unknown = JSON.parse(readFileSync(manifest, "utf8")).exports;
  if (typeof map !== "object" || map === null) return [];
  return Object.entries(map as Record<string, unknown>)
    .map(([subpath, value]) => ({ subpath, target: firstString(value) }))
    .filter(
      (entry): entry is { subpath: string; target: string } =>
        entry.target !== undefined,
    )
    .map(({ subpath, target }) => ({
      subpath,
      file: path.join(pkgDir, target),
    }));
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

/**
 * The hops a config takes outside the package that ships it, read at its own real
 * path. A preset another package inherits by subpath has to stay inside, because a
 * hop that leaves lands outside the tree once the transform walks the chain from
 * the `node_modules` link instead — the #687 shape. At the real path the hop
 * resolves, so a report here names the escape rather than a missing file.
 */
function escapingHops(
  entry: string,
  pkgDir: string,
  seen = new Set<string>(),
): string[] {
  if (seen.has(entry)) return [];
  seen.add(entry);
  const escapes: string[] = [];
  for (const specifier of extendsOf(entry)) {
    const next = resolveSpecifier(specifier, path.dirname(entry));
    if (!existsSync(next)) {
      escapes.push(`${relative(entry)} extends "${specifier}" to nothing`);
      continue;
    }
    if (!next.startsWith(`${pkgDir}${path.sep}`)) {
      escapes.push(
        `${relative(entry)} extends "${specifier}" out of its package`,
      );
      continue;
    }
    escapes.push(...escapingHops(next, pkgDir, seen));
  }
  return escapes;
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
  // The same preset folder, read through the workspace link a consumer's
  // `node_modules` gives it — which is where the two halves of #687 differ.
  const linkedPresets = path.join(
    ROOT,
    "packages/plugin-kit/node_modules/@yadsh/dsh-config/tsconfig",
  );
  const baseViaLink = path.join(linkedPresets, "base.json");
  const nodeViaLink = path.join(linkedPresets, "node.json");
  const linked = existsSync(baseViaLink);

  it("covers every package that ships a tsconfig", () => {
    // Guards the guard: a walk that enumerated nothing would pass vacuously, and a
    // workspace group that is not in the tree drops out of it without a word.
    expect(configs.length).toBeGreaterThanOrEqual(40);
    const silent = WORKSPACE_GROUPS.filter(
      (group) =>
        !configs.some((config) => relative(config).startsWith(`${group}/`)),
    );
    expect(silent).toEqual([]);
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

  it.skipIf(!linked)(
    "really break on the shape #687 shipped, so the check above is not vacuous",
    () => {
      // `base.json` still escapes its package: the walk has to call that unreadable,
      // or it has stopped modelling the failure it guards. Skipped rather than green
      // on a tree without installed workspace links, so the report says the case did
      // not run.
      expect(findBrokenHop(baseViaLink)).toEqual({
        from: relative(baseViaLink),
        specifier: "../../../tsconfig.base.json",
        landed: "packages/plugin-kit/node_modules/tsconfig.base.json",
      });
    },
  );

  it.skipIf(!linked)(
    "keep a preset that stays in its package readable through the same link",
    () => {
      // The measured half of the difference: `node.json` declares no `extends`, so
      // nothing folds against the link and the walk lands. The defect #687 fixed is
      // the escape, not the subpath, and the presets inherited by subpath across
      // this tree are the ones that never escape.
      expect(findBrokenHop(nodeViaLink)).toBeUndefined();
    },
  );
});

describe("tsconfig presets @yadsh/dsh-config publishes", () => {
  const published = exportedSubpaths(CONFIG_PKG).filter((entry) =>
    entry.subpath.startsWith("./tsconfig/"),
  );

  it("keep the branches the tree inherits by subpath", () => {
    const subpaths = published.map((entry) => entry.subpath);
    expect(subpaths).toContain("./tsconfig/node");
    expect(subpaths).toContain("./tsconfig/client");
  });

  it("publish no preset whose chain leaves the package", () => {
    // The rule #687 leaves behind, and the reason `./tsconfig/base` and
    // `./tsconfig/browser` are absent: a subpath that mis-lands under Vite's
    // resolver is a green `tsc` over a red suite, while a subpath that is not there
    // at all fails to resolve for the author on the first run. Consumers that need
    // the escaping presets take them by path inside the workspace, where the walk
    // starts at the real folder.
    const escaping = published.flatMap((entry) =>
      escapingHops(entry.file, CONFIG_PKG),
    );
    expect(escaping).toEqual([]);
  });
});
