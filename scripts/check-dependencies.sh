#!/usr/bin/env bash
#
# check-dependencies.sh — SPEC §27 dependency rule enforcement for the
# dsh-plugins monorepo.
#
# Enforced rules:
#   §27.1  Plugins may depend on shared packages (plugin-kit, ui-kit,
#          test-kit, config — anything under packages/*).
#   §27.2  Shared packages must not depend on concrete plugins
#          (nothing under plugins/* may appear in a packages/* manifest).
#   §27.3  DSH runtime framework packages (@deepseek-ai/*) must be declared
#          as peerDependencies, never regular dependencies.
#   §27.4  test-kit is test-only: it may only appear in devDependencies.
#   §27.5  Cyclic workspace dependencies are forbidden — detected natively
#          via DFS over the workspace graph, guarded by
#          `disallowWorkspaceCycles: true`, and `pnpm dedupe --check` is run
#          as a lockfile-hygiene gate when pnpm is available.
#   §27.6  Every imported package must be explicitly declared in the
#          importing package's manifest (dependencies, peerDependencies,
#          devDependencies or optionalDependencies).
#   §27.7  Hoisting must not satisfy undeclared dependencies — enforced via
#          `nodeLinker: isolated` in pnpm-workspace.yaml plus §27.6.
#   §27.8  No imports of another package's internal source paths
#          (e.g. `@yadsh/x/src/...`).
#   §27.9  No cross-package relative imports (`../../other-plugin/src/...`).
#   §27.10 Workspace packages must be consumed through their declared
#          package `exports` map only.
#
# Usage:   bash scripts/check-dependencies.sh
# Exit:    0 = no violations, 1 = violations found, 2 = setup error.
# Override the repo root for testing:  DSH_DEPS_ROOT=/tmp/fixture bash ...

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="${DSH_DEPS_ROOT:-$(cd -- "$SCRIPT_DIR/.." && pwd -P)}"
export DSH_DEPS_ROOT="$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required but was not found on PATH" >&2
  exit 2
fi

echo "==> SPEC §27 dependency rule check (root: $ROOT)"

# --- pnpm lockfile hygiene gate (feeds its result into the node checker) ---
DEDUPE_STATUS="skipped"
DEDUPE_OUT=""
if command -v pnpm >/dev/null 2>&1; then
  echo "==> pnpm dedupe --check (duplicate workspace versions / lockfile hygiene)"
  DEDUPE_OUT="$(mktemp)"
  trap 'rm -f "$DEDUPE_OUT"' EXIT
  if (cd "$ROOT" && pnpm dedupe --check) >"$DEDUPE_OUT" 2>&1; then
    DEDUPE_STATUS="ok"
    echo "    ok — lockfile is deduped"
  elif grep -q 'DISALLOW_WORKSPACE_CYCLES' "$DEDUPE_OUT"; then
    DEDUPE_STATUS="fail-cycles"
    sed -E '/^(Progress:|\(node:|\(Use .node --trace)/d; s/^/    /' "$DEDUPE_OUT"
  else
    DEDUPE_STATUS="fail"
    sed -E '/^(Progress:|\(node:|\(Use .node --trace)/d; s/^/    /' "$DEDUPE_OUT"
  fi
else
  echo "==> notice: pnpm not found on PATH — skipping 'pnpm dedupe --check' (native cycle detection still runs)"
fi
export DSH_DEPS_DEDUPE_STATUS="$DEDUPE_STATUS"

# --- main checker (node for robust JSON/exports/source handling) ---
node --input-type=module <<'NODE_EOF'
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.env.DSH_DEPS_ROOT;
if (!ROOT) {
  console.error("internal error: DSH_DEPS_ROOT is not set");
  process.exit(2);
}

const violations = [];

function violation(rule, message) {
  violations.push({ rule, message });
}

const CODE_EXT = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
]);
const SCAN_DIRS = ["src", "test", "tests"];
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const DSH_RUNTIME_PREFIXES = ["@deepseek-ai/"];

// ---------------------------------------------------------------------------
// Collect workspace members (publishable packages/plugins and private tooling)
// ---------------------------------------------------------------------------
function listMembers() {
  const members = [];
  const groups = [
    { group: "packages", kind: "shared" },
    { group: "plugins", kind: "plugin" },
    { group: "tooling/generators", kind: "tooling" },
  ];

  for (const { group, kind } of groups) {
    const groupDir = path.join(ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(groupDir, entry.name);
      const file = path.join(dir, "package.json");
      if (!fs.existsSync(file)) continue;
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        violation(
          "manifest",
          `${group}/${entry.name}/package.json: invalid JSON (${err.message})`,
        );
        continue;
      }
      members.push({
        name: pkg.name || `${group}/${entry.name}`,
        group,
        kind,
        dir,
        relDir: `${group}/${entry.name}`,
        pkg,
      });
    }
  }
  return members;
}

const members = listMembers();
const byName = new Map(members.map((m) => [m.name, m]));
const testKit =
  members.find((m) => m.relDir === "packages/test-kit") ??
  members.find((m) => /(^|\/)test-kit$|test-kit\b/.test(m.name));

console.log(
  `==> Scanning ${members.length} workspace member(s): ` +
    members.map((m) => `${m.name} (${m.relDir})`).join(", "),
);
console.log("");

// ---------------------------------------------------------------------------
// §27.2 — shared packages must not depend on concrete plugins
// ---------------------------------------------------------------------------
for (const m of members) {
  if (m.kind !== "shared") continue;
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(m.pkg[field] ?? {})) {
      const target = byName.get(name);
      if (target && target.kind === "plugin") {
        violation(
          "§27.2",
          `shared package '${m.name}' must not depend on plugin '${target.name}' ` +
            `(${m.relDir}/package.json → ${field}.${name}); shared packages may ` +
            `only depend on other shared packages`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// §27.4 — test-kit is test-only (devDependencies exclusively)
// ---------------------------------------------------------------------------
if (testKit) {
  for (const m of members) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      if ((m.pkg[field] ?? {})[testKit.name]) {
        violation(
          "§27.4",
          `'${m.name}' declares test-kit '${testKit.name}' in ${field}; test-kit is ` +
            `test-only and may only appear in devDependencies (${m.relDir}/package.json)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// §27.3 — DSH runtime framework packages must be peers, not regular deps
// ---------------------------------------------------------------------------
for (const m of members) {
  for (const name of Object.keys(m.pkg.dependencies ?? {})) {
    if (DSH_RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      violation(
        "§27.3",
        `'${m.name}' declares DSH runtime package '${name}' in dependencies; ` +
          `DSH framework packages must be peerDependencies — move '${name}' to ` +
          `peerDependencies (keep a devDependencies copy for local typecheck/tests) ` +
          `(${m.relDir}/package.json)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phantom workspace deps: declared '@yadsh/...'-style names that are not
// workspace members at all
// ---------------------------------------------------------------------------
const workspaceScopes = new Set(
  members.map((m) => `${m.name.split("/")[0]}/`),
);
for (const m of members) {
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(m.pkg[field] ?? {})) {
      if (
        workspaceScopes.has(`${name.split("/")[0]}/`) &&
        !byName.has(name)
      ) {
        violation(
          "manifest",
          `'${m.name}' declares '${name}' in ${field}, but no such workspace ` +
            `package exists in the pnpm workspace (${m.relDir}/package.json)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// §27.5 — cyclic workspace dependencies (native DFS over the full graph)
// ---------------------------------------------------------------------------
const graph = new Map();
for (const m of members) {
  const edges = new Set();
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(m.pkg[field] ?? {})) {
      if (byName.has(name) && name !== m.name) edges.add(name);
    }
  }
  graph.set(m.name, edges);
}
{
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(members.map((m) => [m.name, WHITE]));
  const cycles = [];
  const visit = (node, stack) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const state = color.get(next);
      if (state === GRAY) {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next].join(" -> "));
      } else if (state === WHITE) {
        visit(next, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };
  for (const m of members) {
    if (color.get(m.name) === WHITE) visit(m.name, []);
  }
  for (const cycle of cycles) {
    violation(
      "§27.5",
      `cyclic workspace dependency detected: ${cycle}; ` +
        `break the cycle (e.g. extract a shared package)`,
    );
  }
}

// ---------------------------------------------------------------------------
// §27.5 / §27.7 — pnpm workspace guards (cycles + no-hoisting)
// ---------------------------------------------------------------------------
const wsYamlPath = path.join(ROOT, "pnpm-workspace.yaml");
if (fs.existsSync(wsYamlPath)) {
  const text = fs.readFileSync(wsYamlPath, "utf8");
  if (!/^nodeLinker:\s*isolated\s*$/m.test(text)) {
    violation(
      "§27.7",
      `pnpm-workspace.yaml must set 'nodeLinker: isolated' so undeclared ` +
        `dependencies cannot be satisfied by hoisting`,
    );
  }
  if (!/^disallowWorkspaceCycles:\s*true\s*$/m.test(text)) {
    violation(
      "§27.5",
      `pnpm-workspace.yaml must set 'disallowWorkspaceCycles: true' so pnpm ` +
        `rejects workspace cycles at install time`,
    );
  }
} else {
  violation(
    "§27.5",
    `pnpm-workspace.yaml not found at repo root; pnpm cannot enforce ` +
      `workspace cycle rejection or isolated node_modules`,
  );
}

// ---------------------------------------------------------------------------
// §27.5 — pnpm dedupe gate result
// ---------------------------------------------------------------------------
if (process.env.DSH_DEPS_DEDUPE_STATUS === "fail-cycles") {
  violation(
    "§27.5",
    `'pnpm dedupe --check' reported cyclic workspace dependencies — pnpm ` +
      `rejected the workspace (see its output above). Break the cycle so the ` +
      `'disallowWorkspaceCycles: true' guard passes.`,
  );
} else if (process.env.DSH_DEPS_DEDUPE_STATUS === "fail") {
  violation(
    "§27.5",
    `'pnpm dedupe --check' reported the lockfile is not deduped (duplicate or ` +
      `removable workspace entries — shared version drift). Run 'pnpm dedupe' ` +
      `and commit the updated pnpm-lock.yaml.`,
  );
}

// ---------------------------------------------------------------------------
// Source scanning — §27.6, §27.8, §27.9, §27.10
// ---------------------------------------------------------------------------
function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function extractSpecifiers(code, file) {
  const specifiers = new Set();
  // Parse real syntax instead of grepping source text: generators legitimately
  // contain import statements inside template literals for the files they emit.
  const sourceFile = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    false,
  );
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      ) {
        addLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function rootOfSpecifier(spec) {
  return spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];
}

function exportKeys(pkg) {
  const exportsMap = pkg.exports;
  if (exportsMap == null) return null;
  if (typeof exportsMap === "string" || Array.isArray(exportsMap)) return ["."];
  return Object.keys(exportsMap);
}

function isInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

let filesScanned = 0;
for (const m of members) {
  const files = [];
  for (const dirName of SCAN_DIRS) {
    collectFiles(path.join(m.dir, dirName), files);
  }

  for (const file of files) {
    filesScanned += 1;
    const relFile = path.relative(ROOT, file).split(path.sep).join("/");
    const code = fs.readFileSync(file, "utf8");

    for (const spec of extractSpecifiers(code, file)) {
      if (spec.startsWith("node:")) continue; // builtins are always available

      if (spec.startsWith(".")) {
        // §27.9 — relative imports must stay inside the package
        const resolved = path.resolve(path.dirname(file), spec);
        if (!isInside(m.dir, resolved)) {
          const targetMember = members.find(
            (other) => other !== m && isInside(other.dir, resolved),
          );
          if (targetMember) {
            violation(
              "§27.9",
              `${relFile}: relative import '${spec}' reaches into another package ` +
                `('${targetMember.name}' at ${targetMember.relDir}/src); depend on the ` +
                `package by name and use its public exports instead`,
            );
          } else {
            violation(
              "§27.9",
              `${relFile}: relative import '${spec}' escapes the package root of ` +
                `'${m.name}' (${m.relDir})`,
            );
          }
        }
        continue;
      }

      if (path.isAbsolute(spec)) {
        violation(
          "§27.9",
          `${relFile}: absolute-path import '${spec}' is not allowed; import ` +
            `packages by name`,
        );
        continue;
      }

      // Bare specifier
      const root = rootOfSpecifier(spec);
      if (root === m.name) continue; // self-reference through own exports is fine

      const declaredIn = DEP_FIELDS.filter((field) => (m.pkg[field] ?? {})[root]);
      if (declaredIn.length === 0) {
        violation(
          "§27.6",
          `${relFile}: imports '${spec}' but '${root}' is not declared in ` +
            `${m.relDir}/package.json; declare it explicitly (§27.6) — do not rely ` +
            `on hoisting (§27.7)`,
        );
        continue;
      }

      const target = byName.get(root);
      if (!target) continue; // external package, declared — fine

      const sub = spec.slice(root.length);
      if (sub === "" || sub === "/") continue; // root entrypoint

      if (sub.startsWith("/src/") || sub === "/src") {
        violation(
          "§27.8",
          `${relFile}: imports '${spec}' — deep import into another package's ` +
            `internal source; import the public entrypoints exposed via its exports`,
        );
        continue;
      }

      const keys = exportKeys(target.pkg);
      const key = `./${sub.replace(/^\//, "")}`;
      if (keys) {
        if (!keys.includes(key)) {
          violation(
            "§27.10",
            `${relFile}: '${spec}' does not match any declared export of ` +
              `'${target.name}' (exports: ${keys.map((k) => JSON.stringify(k)).join(", ")}); ` +
              `consume workspace packages through their declared exports only`,
          );
        }
      } else {
        violation(
          "§27.10",
          `${relFile}: '${target.name}' declares no "exports" map, so '${spec}' ` +
            `resolves into its internals by file layout; add an exports entry in ` +
            `${target.relDir}/package.json and import the public entrypoint`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`==> Scanned ${filesScanned} source file(s)`);
console.log("");
if (violations.length > 0) {
  console.log(`✗ ${violations.length} dependency rule violation(s):`);
  console.log("");
  for (const v of violations) {
    console.log(`  [${v.rule}] ${v.message}`);
  }
  console.log("");
  console.log("Summary: FAILED — see SPEC §27 for the rules referenced above.");
  process.exit(1);
}

console.log("✓ no dependency rule violations found");
console.log("Summary: OK — all SPEC §27 dependency rules satisfied.");
process.exit(0);
NODE_EOF
