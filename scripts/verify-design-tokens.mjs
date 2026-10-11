/**
 * Design token existence.
 *
 * A `var(--dsw-…)` is a claim about the Host's stylesheet, and the browser
 * settles that claim in silence: when the name is absent, the substitution
 * yields the guaranteed-invalid value, so the whole declaration is dropped at
 * computed-value time — `color` falls back to inheritance and `background` to
 * transparent — and nothing is written to the console. `Issue #717` is the
 * symptom: four blocks of refusal text named `--dsw-alias-bg-error` and
 * `--dsw-alias-label-error`, the theme declares neither, and an operator read a
 * hard failure as ordinary small text.
 *
 * So the vocabulary is checked against its source instead of against memory. The
 * source is the Host theme package the workspace already pins —
 * `@deepseek-ai/dsh-client-ui-theme`, the publisher of every `--dsw-*` name —
 * read from the installed tree through a manifest that depends on it. A name it
 * does not declare fails as `path:line`, and the gate is deliberately narrower
 * than the palette: it asks only whether a name exists, never whether the choice
 * of colour was right, which stays a review question.
 *
 * What is read as a use is a substitution, not a mention: `var(--dsw-x)` and
 * `var(--dsw-x, …)` count, while the prose `var(--dsw-alias-*)` in a comment is
 * not one, because an explanatory wildcard would otherwise report as a claim.
 * A name that carries a fallback still fails when it does not exist. A fallback
 * keeps the declaration alive but the style paints a colour the Host never
 * chose, and the reason a dead name was written down is usually that a live one
 * exists — `state-error-primary` was there all along.
 */
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const themePackageName = "@deepseek-ai/dsh-client-ui-theme";
const sourceRoots = ["plugins", "packages"];
const sourceExtensions = /\.[cm]?[jt]sx?$/u;
const skippedDirectories = new Set(["node_modules", "lib", "dist", "coverage"]);

/**
 * A substitution: the name is followed by the `)` that closes it or the `,` that
 * opens its fallback. Custom properties are case-sensitive, so the pattern is
 * lowercase and exact.
 */
const substitution = /var\(\s*(--dsw-[a-z0-9-]+)\s*[,)]/gu;

/** A declaration of a custom property, as the theme's own sheet writes it. */
const declaration = /(--dsw-[a-z0-9-]+)\s*:/gu;

/** The dependency fields a package may name the theme in. */
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function usedTokens(source) {
  const uses = [];
  for (const match of source.matchAll(substitution)) {
    uses.push({ name: match[1], index: match.index });
  }
  return uses;
}

export function declaredTokens(sheet) {
  return new Set([...sheet.matchAll(declaration)].map((match) => match[1]));
}

/**
 * Findings for one source: every substituted name the declared set does not hold.
 */
export function auditSource(source, declared) {
  return usedTokens(source)
    .filter((use) => !declared.has(use.name))
    .map((use) => ({
      index: use.index,
      message: `${use.name} is not declared by ${themePackageName}`,
    }));
}

async function sourceFiles(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // A package with no `src` tree — a generator, a scripts-only library —
    // substitutes no token, so there is nothing here to report on it.
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      found.push(...(await sourceFiles(join(directory, entry.name))));
    } else if (sourceExtensions.test(entry.name)) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

async function workspaceManifests(root) {
  const manifests = [];
  for (const area of sourceRoots) {
    let entries;
    try {
      entries = await readdir(join(root, area), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, area, entry.name);
      try {
        manifests.push({
          directory,
          json: JSON.parse(
            await readFile(join(directory, "package.json"), "utf8"),
          ),
        });
      } catch {
        continue;
      }
    }
  }
  return manifests;
}

/**
 * The installed theme package: resolved through a workspace manifest that
 * depends on it, so the pin the plugins build against is the pin this gate reads.
 */
export async function themeDirectory(root = workspaceRoot) {
  const anchors = [];
  for (const manifest of await workspaceManifests(root)) {
    const names = dependencyFields
      .flatMap((field) => Object.keys(manifest.json[field] ?? {}))
      .filter((name) => name === themePackageName);
    if (names.length > 0) anchors.push(manifest.directory);
  }
  if (anchors.length === 0) {
    throw new Error(
      `no workspace package depends on ${themePackageName}, so the ` +
        "`--dsw-*` vocabulary has no source of truth to check against",
    );
  }
  for (const anchor of anchors) {
    try {
      const require = createRequire(join(anchor, "package.json"));
      return dirname(require.resolve(`${themePackageName}/package.json`));
    } catch {
      continue;
    }
  }
  throw new Error(
    `${themePackageName} is declared by ${anchors
      .map((anchor) => relative(root, anchor).split(sep).join("/"))
      .join(", ")} but not installed — run pnpm install`,
  );
}

/** Every name the theme declares, read from its built sheets. */
export async function readDeclaredTokens(directory) {
  const declared = new Set();
  const walk = async (where) => {
    for (const entry of await readdir(where, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await walk(join(where, entry.name));
        continue;
      }
      if (!/\.(js|css)$/u.test(entry.name)) continue;
      for (const name of declaredTokens(
        await readFile(join(where, entry.name), "utf8"),
      )) {
        declared.add(name);
      }
    }
  };
  await walk(join(directory, "lib"));
  if (declared.size === 0) {
    throw new Error(
      `${themePackageName} at ${directory} declares no --dsw-* token`,
    );
  }
  return declared;
}

export async function verifyDesignTokens({ root = workspaceRoot } = {}) {
  const declared = await readDeclaredTokens(await themeDirectory(root));
  const findings = [];
  let sources = 0;
  let uses = 0;
  for (const area of sourceRoots) {
    let entries;
    try {
      entries = await readdir(join(root, area), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const files = await sourceFiles(join(root, area, entry.name, "src"));
      for (const file of files) {
        const source = await readFile(file, "utf8");
        sources += 1;
        uses += usedTokens(source).length;
        const path = relative(root, file).split(sep).join("/");
        const lineAt = (index) => source.slice(0, index).split("\n").length;
        for (const finding of auditSource(source, declared)) {
          findings.push(`${path}:${lineAt(finding.index)}: ${finding.message}`);
        }
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(`design tokens failed:\n- ${findings.sort().join("\n- ")}`);
  }
  return { sources, uses, declared: declared.size };
}

async function main() {
  const { sources, uses, declared } = await verifyDesignTokens();
  console.log(
    `design tokens verified: ${uses} substitutions in ${sources} sources against ${declared} declared names`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
