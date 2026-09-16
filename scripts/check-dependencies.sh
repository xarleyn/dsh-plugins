#!/usr/bin/env bash
#
# check-dependencies.sh — bash wrapper around scripts/check-dependencies.mjs,
# the SPEC §27 dependency rule enforcement for the dsh-plugins monorepo.
#
# Enforced rules (implemented in check-dependencies.mjs):
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
# This wrapper owns the bash-specific parts of the contract:
#   - resolves the repo root (DSH_DEPS_ROOT override for testing) and exports
#     it for the Node checker;
#   - runs `pnpm dedupe --check` (a pnpm/lockfile concern) and feeds the
#     result to the checker via DSH_DEPS_DEDUPE_STATUS.
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

# --- main checker ---
node "$SCRIPT_DIR/check-dependencies.mjs"
