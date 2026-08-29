#!/usr/bin/env bash
#
# tarball-verify.sh — SPEC §16 release verification gates (dsh-plugins monorepo).
#
# Packs one or more workspace packages with pnpm, inspects the packed tarball,
# and smoke-installs it into a clean npm environment. Enforced gates:
#
#   1. lib/ exists in the tarball and contains compiled .js output
#   2. packed package.json has a correct name and version (semver, matches source)
#   3. plugins/* declare dsh.bundle.patch (SPEC §4); packages/* must not
#      declare it unless explicitly needed (warning)
#   4. cordis.patch.yml is included in the tarball when required (plugins)
#   5. every exported entrypoint (exports / main / types) exists in the tarball
#   6. no workspace: / catalog: protocol leaks into the packed manifest
#   7. the tarball installs into a clean npm environment and its entry module
#      loads under plain Node (smoke test)
#
# Usage:
#   scripts/tarball-verify.sh <package-path> [<package-path> ...]
#   scripts/tarball-verify.sh --all
#
# Examples:
#   scripts/tarball-verify.sh plugins/dsh-draft-sessions
#   scripts/tarball-verify.sh packages/plugin-kit packages/test-kit
#   scripts/tarball-verify.sh --all
#
# Environment flags:
#   TARBALL_VERIFY_KEEP=1               keep temp working dirs for debugging
#   TARBALL_VERIFY_SKIP_INSTALL=1       skip gate 7 entirely
#   TARBALL_VERIFY_SKIP_SMOKE_IMPORT=1  skip only the entry-module load check
#
# Requirements: node, npm, pnpm (pnpm pack performs the workspace:/catalog:
# replacement required by gate 6), tar. Packages must be built (`pnpm build`)
# before verification.
#
# Exit codes:
#   0  all requested packages passed (private packages are skipped, not failed)
#   1  one or more gates failed
#   2  usage or environment error

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
else
  C_RESET=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_CYAN=""
fi

FAILURES=0
PKG_PASS=0
PKG_FAIL=0

info() { printf '%s[info]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok()   { printf '%s[ ok ]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%s[FAIL]%s %s\n' "$C_RED" "$C_RESET" "$*"; FAILURES=$((FAILURES + 1)); }
die()  { printf '%s[error]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Temp workspace management
# ---------------------------------------------------------------------------
WORK_DIRS=()
WORK_DIR=""

cleanup() {
  if [ "${TARBALL_VERIFY_KEEP:-0}" = "1" ]; then
    warn "TARBALL_VERIFY_KEEP=1 — keeping temp dirs:"
    printf '  %s\n' ${WORK_DIRS[@]+"${WORK_DIRS[@]}"}
  else
    rm -rf ${WORK_DIRS[@]+"${WORK_DIRS[@]}"}
  fi
}
trap cleanup EXIT

# to_posix <path> — normalize Windows-style paths to POSIX form on MSYS/Git Bash
to_posix() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s' "$1"
  fi
}

# Sets the global WORK_DIR to a fresh temp dir (must not run in a subshell).
new_workdir() {
  WORK_DIR="$(mktemp -d)" || die "mktemp failed — cannot create temp dir"
  # On MSYS/Git Bash mktemp may honor $TEMP and return a Windows-style path,
  # which MSYS GNU tar misreads as a remote host ("Cannot connect to C:").
  # Normalize to a POSIX path so bash-native tools see a consistent form.
  WORK_DIR="$(to_posix "$WORK_DIR")"
  WORK_DIRS+=("$WORK_DIR")
}

for bin in node npm pnpm tar; do
  command -v "$bin" >/dev/null 2>&1 ||
    die "$bin is required (pnpm pack performs the workspace:/catalog: replacement verified by gate 6)"
done

# ---------------------------------------------------------------------------
# JSON helpers (node-backed; empty output = field absent)
# ---------------------------------------------------------------------------
# jsonq <file> <dot.path> — print a scalar, or the JSON form of objects/arrays
jsonq() {
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const path = process.argv[2] || "";
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { process.exit(0); }
    let cur = doc;
    if (path !== "") {
      for (const key of path.split(".")) {
        if (cur == null || typeof cur !== "object" || !(key in cur)) process.exit(0);
        cur = cur[key];
      }
    }
    if (cur === undefined || cur === null) process.exit(0);
    process.stdout.write(typeof cur === "object" ? JSON.stringify(cur) : String(cur));
  ' "$1" "$2"
}

# deps_of <package.json> <field> — "name<TAB>range" lines
deps_of() {
  node -e '
    const fs = require("fs");
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(0); }
    const deps = pkg[process.argv[2]];
    if (deps && typeof deps === "object") {
      for (const [name, range] of Object.entries(deps)) {
        process.stdout.write(name + "\t" + range + "\n");
      }
    }
  ' "$1" "$2"
}

# export_paths <package.json> — every file path referenced by exports/main/types
export_paths() {
  node -e '
    const fs = require("fs");
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(0); }
    const seen = new Set();
    const walk = (n) => {
      if (typeof n === "string") { seen.add(n); return; }
      if (n && typeof n === "object") for (const v of Object.values(n)) walk(v);
    };
    walk(pkg.exports);
    if (typeof pkg.main === "string") seen.add(pkg.main);
    if (typeof pkg.types === "string") seen.add(pkg.types);
    for (const p of seen) process.stdout.write(p + "\n");
  ' "$1"
}

# protocol_leaks <package.json> — "field.name: range" lines using workspace:/catalog:
protocol_leaks() {
  node -e '
    const fs = require("fs");
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(0); }
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, range] of Object.entries(deps)) {
        if (typeof range === "string" && (range.startsWith("workspace:") || range.startsWith("catalog:"))) {
          process.stdout.write(field + "." + name + ": " + range + "\n");
        }
      }
    }
  ' "$1"
}

# default_entry <package.json> — exports["."].default (or string exports), else main
default_entry() {
  node -e '
    const fs = require("fs");
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { process.exit(0); }
    let entry;
    const exp = pkg.exports;
    if (typeof exp === "string") {
      entry = exp;
    } else if (exp && typeof exp === "object") {
      const dot = exp["."];
      if (typeof dot === "string") entry = dot;
      else if (dot && typeof dot === "object" && typeof dot.default === "string") entry = dot.default;
    }
    if (!entry && typeof pkg.main === "string") entry = pkg.main;
    if (entry) process.stdout.write(entry);
  ' "$1"
}

# ---------------------------------------------------------------------------
# Workspace registry
# ---------------------------------------------------------------------------
# list_workspace_packages — "name<TAB>rel-dir" for every workspace package
list_workspace_packages() {
  local base dir name
  for base in plugins packages; do
    [ -d "$REPO_ROOT/$base" ] || continue
    for dir in "$REPO_ROOT/$base"/*/; do
      [ -f "${dir}package.json" ] || continue
      name="$(jsonq "${dir}package.json" name)"
      [ -n "$name" ] || continue
      printf '%s\t%s\n' "$name" "$(printf '%s' "${dir#"$REPO_ROOT"/}" | sed 's:/*$::')"
    done
  done
}

# find_workspace_dir <name> — rel dir of the workspace package with that name
find_workspace_dir() {
  local name="$1" wname wdir
  while IFS=$'\t' read -r wname wdir; do
    [ -n "${wname:-}" ] || continue
    if [ "$wname" = "$name" ]; then
      printf '%s' "$wdir"
      return 0
    fi
  done <<EOF2
$(list_workspace_packages)
EOF2
  return 0
}

# ---------------------------------------------------------------------------
# Packing
# ---------------------------------------------------------------------------
# pack_package <rel-dir> <dest-dir> — pnpm pack into dest; prints tgz path
pack_package() {
  local dir="$REPO_ROOT/$1" dest="$2" out last tgz=""
  mkdir -p "$dest" || return 1
  out="$(cd "$dir" && pnpm pack --pack-destination "$dest" 2>&1)" || {
    printf '%s\n' "$out" >&2
    return 1
  }
  # pnpm pack prints the produced tarball path; fall back to newest tgz in dest
  last="$(printf '%s\n' "$out" | sed '/^[[:space:]]*$/d' | tail -n 1)"
  case "$last" in
    *.tgz)
      if [ -f "$dest/$last" ]; then
        tgz="$dest/$last"
      elif [ -f "$last" ]; then
        tgz="$last"
      fi
      ;;
  esac
  if [ -z "$tgz" ]; then
    tgz="$(ls -t "$dest"/*.tgz 2>/dev/null | head -n 1)"
    if [ -z "$tgz" ] || [ ! -f "$tgz" ]; then
      printf 'could not locate packed tarball for %s\npnpm pack output:\n%s\n' "$1" "$out" >&2
      return 1
    fi
  fi
  printf '%s' "$(to_posix "$tgz")"
}

# ---------------------------------------------------------------------------
# Internal dependency closure (for gate 7 npm install)
# ---------------------------------------------------------------------------
declare -A VISITED

# collect_internal_deps <rel-dir> — transitively record workspace deps in VISITED
collect_internal_deps() {
  local dir_rel="$1" pkg_json="$REPO_ROOT/$1/package.json"
  [ -f "$pkg_json" ] || return 0
  [ -n "${VISITED[$dir_rel]:-}" ] && return 0
  VISITED[$dir_rel]=1
  local field dep_name dep_range dep_dir
  for field in dependencies optionalDependencies; do
    while IFS=$'\t' read -r dep_name dep_range; do
      [ -n "${dep_name:-}" ] || continue
      # only source-manifest workspace: references need seeding on install
      case "${dep_range:-}" in
        workspace:*) ;;
        *) continue ;;
      esac
      dep_dir="$(find_workspace_dir "$dep_name")"
      [ -n "$dep_dir" ] && collect_internal_deps "$dep_dir"
    done < <(deps_of "$pkg_json" "$field")
  done
  return 0
}

# ---------------------------------------------------------------------------
# Gate 7 — install the tarball into a clean npm environment
# ---------------------------------------------------------------------------
gate_install() {
  # $1 = rel dir, $2 = package name, $3 = target tgz path
  local rel="$1" name="$2" tgz="$3"
  local work deps_dir install_dir nm_dir dir_rel dep_name dep_tgz npm_log
  new_workdir
  work="$WORK_DIR"
  deps_dir="$work/deps"
  install_dir="$work/install"
  nm_dir="$install_dir/node_modules"
  mkdir -p "$deps_dir" "$install_dir" || { fail "gate 7 — cannot prepare install sandbox"; return 0; }

  # Internal workspace deps do not exist on the public registry; the packed
  # manifest carries real semver ranges for them (pnpm rewrote workspace:),
  # so npm would try to fetch them and fail with E404. Seed them directly
  # into the consumer node_modules: a seeded node with a matching name and a
  # version satisfying the range keeps npm from ever querying the registry
  # for internal packages. (Relative file:/overrides don't work here — npm
  # resolves them against the dependent package inside node_modules.)
  VISITED=()
  collect_internal_deps "$rel"

  for dir_rel in ${VISITED[@]+"${!VISITED[@]}"}; do
    [ "$dir_rel" = "$rel" ] && continue
    dep_name="$(jsonq "$REPO_ROOT/$dir_rel/package.json" name)"
    if [ -z "$dep_name" ]; then
      fail "gate 7 — internal dependency $dir_rel has no name in package.json"
      return 0
    fi
    if ! dep_tgz="$(pack_package "$dir_rel" "$deps_dir/$dir_rel")"; then
      fail "gate 7 — failed to pack internal dependency $dir_rel"
      return 0
    fi
    mkdir -p "$nm_dir/$dep_name" || { fail "gate 7 — cannot seed $dep_name"; return 0; }
    tar -xzf "$dep_tgz" -C "$nm_dir/$dep_name" --strip-components=1 ||
      { fail "gate 7 — cannot extract seeded dependency $dep_name"; return 0; }
    [ -f "$nm_dir/$dep_name/package.json" ] ||
      { fail "gate 7 — seeded dependency $dep_name has no package.json"; return 0; }
    info "seeding internal dependency $dep_name from workspace tarball ($(basename "$dep_tgz"))"
  done

  local tgz_base
  tgz_base="$(basename "$tgz")"
  cp "$tgz" "$install_dir/$tgz_base" || { fail "gate 7 — cannot copy tarball into install sandbox"; return 0; }

  cat > "$install_dir/package.json" <<EOF
{
  "name": "dsh-tarball-verify-consumer",
  "version": "0.0.0",
  "private": true
}
EOF

  npm_log="$install_dir/npm-install.log"
  if (cd "$install_dir" && npm install --no-save --no-audit --no-fund --loglevel=error "./$tgz_base") >"$npm_log" 2>&1; then
    ok "gate 7 — npm install from tarball succeeded"
  else
    fail "gate 7 — npm install of the tarball failed:"
    tail -n 15 "$npm_log" | sed 's/^/        /'
    return 0
  fi

  local nm_pkg="$install_dir/node_modules/$name"
  if [ ! -f "$nm_pkg/package.json" ]; then
    fail "gate 7 — $name not present under node_modules after install"
    return 0
  fi

  # smoke-test loading: import the default entry under plain Node
  if [ "${TARBALL_VERIFY_SKIP_SMOKE_IMPORT:-0}" = "1" ]; then
    warn "gate 7 — entry smoke import skipped (TARBALL_VERIFY_SKIP_SMOKE_IMPORT=1)"
    return 0
  fi
  local entry entry_abs
  entry="$(default_entry "$nm_pkg/package.json")"
  if [ -z "$entry" ]; then
    warn "gate 7 — no default entrypoint to smoke-import"
    return 0
  fi
  case "$entry" in
    *"*"*)
      warn "gate 7 — default entrypoint is a pattern ($entry), smoke import skipped"
      return 0
      ;;
  esac
  entry_abs="$nm_pkg/${entry#./}"
  if [ ! -f "$entry_abs" ]; then
    fail "gate 7 — installed entrypoint file missing: $entry"
    return 0
  fi
  if node -e '
      const { pathToFileURL } = require("url");
      import(pathToFileURL(process.argv[1]).href).then(
        () => process.exit(0),
        (err) => { console.error(String((err && err.message) || err)); process.exit(1); }
      );
    ' "$entry_abs"; then
    ok "gate 7 — entry module loads under plain Node: $entry"
  else
    fail "gate 7 — entry module failed to load: $entry (see error above)"
  fi
}

# ---------------------------------------------------------------------------
# Per-package verification
# ---------------------------------------------------------------------------
verify_package() {
  local arg="$1" pkg_dir rel src_pkg
  if [ "${arg#/*}" = "$arg" ]; then
    pkg_dir="$REPO_ROOT/$arg"
  else
    pkg_dir="$arg"
  fi
  pkg_dir="$(cd "$pkg_dir" 2>/dev/null && pwd -P)" || {
    fail "$arg: package directory not found"
    PKG_FAIL=$((PKG_FAIL + 1))
    return 0
  }
  rel="${pkg_dir#"$REPO_ROOT"/}"
  src_pkg="$pkg_dir/package.json"
  [ -f "$src_pkg" ] || {
    fail "$rel: package.json not found — not a package directory"
    PKG_FAIL=$((PKG_FAIL + 1))
    return 0
  }

  local private
  private="$(jsonq "$src_pkg" private)"
  if [ "$private" = "true" ]; then
    info "$rel: private package — skipped (not publishable)"
    return 0
  fi

  local name version is_plugin=0
  name="$(jsonq "$src_pkg" name)"
  version="$(jsonq "$src_pkg" version)"
  [ -n "$name" ] || {
    fail "$rel: source package.json has no name field"
    PKG_FAIL=$((PKG_FAIL + 1))
    return 0
  }
  case "$rel" in
    plugins/*) is_plugin=1 ;;
  esac

  echo ""
  if [ "$is_plugin" -eq 1 ]; then
    info "=== Verifying $rel ($name@$version) [plugin] ==="
  else
    info "=== Verifying $rel ($name@$version) [shared package] ==="
  fi

  local before=$FAILURES

  # ---- pack & extract -----------------------------------------------------
  local work tgz packed packed_pkg
  new_workdir
  work="$WORK_DIR"
  if ! tgz="$(pack_package "$rel" "$work/pack")"; then
    fail "$rel: pnpm pack failed (see output above)"
    PKG_FAIL=$((PKG_FAIL + 1))
    return 0
  fi
  info "packed $(basename "$tgz")"

  mkdir -p "$work/extracted" || { fail "$rel: cannot create extraction dir"; PKG_FAIL=$((PKG_FAIL + 1)); return 0; }
  tar -xzf "$tgz" -C "$work/extracted" || { fail "$rel: failed to extract tarball"; PKG_FAIL=$((PKG_FAIL + 1)); return 0; }
  packed="$work/extracted/package"
  packed_pkg="$packed/package.json"
  [ -f "$packed_pkg" ] || { fail "$rel: tarball does not contain package/package.json"; PKG_FAIL=$((PKG_FAIL + 1)); return 0; }

  # ---- gate 1: lib/ with compiled output ----------------------------------
  if [ ! -d "$packed/lib" ]; then
    fail "gate 1 — lib/ missing from packed tarball (missing build output or 'files' entry?)"
  else
    local js_count
    js_count="$(find "$packed/lib" -type f -name '*.js' | wc -l | tr -d '[:space:]')"
    if [ "$js_count" -eq 0 ]; then
      fail "gate 1 — lib/ exists but contains no compiled .js output"
    else
      ok "gate 1 — lib/ present with $js_count compiled .js file(s)"
    fi
  fi

  # ---- gate 2: correct name and version -----------------------------------
  local p_name p_version semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
  p_name="$(jsonq "$packed_pkg" name)"
  p_version="$(jsonq "$packed_pkg" version)"
  if [ -z "$p_name" ]; then
    fail "gate 2 — packed package.json has no name"
  elif [ "$p_name" != "$name" ]; then
    fail "gate 2 — packed name '$p_name' does not match source name '$name'"
  fi
  if [ -z "$p_version" ]; then
    fail "gate 2 — packed package.json has no version"
  elif ! [[ "$p_version" =~ $semver_re ]]; then
    fail "gate 2 — packed version '$p_version' is not valid semver"
  elif [ "$p_version" != "$version" ]; then
    fail "gate 2 — packed version '$p_version' does not match source version '$version'"
  fi
  if [ -n "$p_name" ] && [ "$p_name" = "$name" ] && [ -n "$p_version" ] && [[ "$p_version" =~ $semver_re ]] && [ "$p_version" = "$version" ]; then
    ok "gate 2 — name and version correct ($name@$p_version)"
  fi

  # ---- gate 3: DSH bundle metadata ----------------------------------------
  local bundle_patch patch_rel
  bundle_patch="$(jsonq "$packed_pkg" dsh.bundle.patch)"
  if [ "$is_plugin" -eq 1 ]; then
    if [ -z "$bundle_patch" ]; then
      fail "gate 3 — plugin tarball is missing dsh.bundle.patch metadata (SPEC §4)"
    else
      patch_rel="${bundle_patch#./}"
      if [ -f "$packed/$patch_rel" ]; then
        ok "gate 3 — dsh.bundle.patch present and referenced file exists ($bundle_patch)"
      else
        fail "gate 3 — dsh.bundle.patch references '$bundle_patch' but that file is not in the tarball"
      fi
    fi
  else
    if [ -n "$bundle_patch" ]; then
      warn "gate 3 — shared package carries dsh.bundle.patch ('$bundle_patch'); allowed only when explicitly needed (SPEC §4)"
    else
      ok "gate 3 — shared package free of dsh.bundle metadata"
    fi
  fi

  # ---- gate 4: cordis.patch.yml included when required ---------------------
  if [ "$is_plugin" -eq 1 ]; then
    if [ ! -f "$pkg_dir/cordis.patch.yml" ]; then
      ok "gate 4 — no cordis.patch.yml in source (nothing to include)"
    elif [ -f "$packed/cordis.patch.yml" ]; then
      ok "gate 4 — cordis.patch.yml included in tarball"
    else
      fail "gate 4 — source cordis.patch.yml is NOT included in the tarball (add it to the files field)"
    fi
  else
    ok "gate 4 — not applicable (shared package)"
  fi

  # ---- gate 5: exported entrypoints exist ---------------------------------
  local export_list entry_path missing_count=0
  export_list="$(export_paths "$packed_pkg")"
  if [ -z "$export_list" ]; then
    fail "gate 5 — no entrypoints declared (neither exports nor main/types)"
  else
    while IFS= read -r entry_path; do
      [ -n "$entry_path" ] || continue
      case "$entry_path" in
        ./*) ;;
        *) warn "gate 5 — skipping non-relative export target: $entry_path"; continue ;;
      esac
      case "$entry_path" in
        *"*"*) warn "gate 5 — export uses a pattern, existence not verified: $entry_path"; continue ;;
      esac
      if [ ! -f "$packed/${entry_path#./}" ]; then
        fail "gate 5 — exported entrypoint missing from tarball: $entry_path"
        missing_count=$((missing_count + 1))
      fi
    done <<< "$export_list"
    [ "$missing_count" -eq 0 ] && ok "gate 5 — all exported entrypoints exist in the tarball"
  fi

  # ---- gate 6: no workspace:/catalog: protocol leaks -----------------------
  local leaks leak
  leaks="$(protocol_leaks "$packed_pkg")"
  if [ -n "$leaks" ]; then
    while IFS= read -r leak; do
      [ -n "$leak" ] && fail "gate 6 — protocol leaked into packed manifest: $leak"
    done <<< "$leaks"
  else
    ok "gate 6 — no workspace:/catalog: protocol leaks in packed manifest"
  fi

  # ---- gate 7: install from tarball ----------------------------------------
  gate_install "$rel" "$name" "$tgz"

  # ---- verdict --------------------------------------------------------------
  if [ "$FAILURES" -eq "$before" ]; then
    PKG_PASS=$((PKG_PASS + 1))
    ok "$rel: ALL GATES PASSED"
  else
    PKG_FAIL=$((PKG_FAIL + 1))
    info "$rel: FAILED ($((FAILURES - before)) gate error(s))"
  fi
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
verify_all() {
  local base dir any=0
  for base in plugins packages; do
    [ -d "$REPO_ROOT/$base" ] || continue
    for dir in "$REPO_ROOT/$base"/*/; do
      [ -f "${dir}package.json" ] || continue
      any=1
      verify_package "${dir#"$REPO_ROOT"/}"
    done
  done
  [ "$any" -eq 1 ] || die "no workspace packages found under plugins/ or packages/"
}

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

summary_and_exit() {
  echo ""
  if [ "$FAILURES" -eq 0 ]; then
    ok "tarball verification PASSED — $PKG_PASS package(s) verified"
    exit 0
  fi
  fail "tarball verification FAILED — $PKG_FAIL package(s) failed, $PKG_PASS passed, $FAILURES gate error(s) total"
  exit 1
}

main() {
  if [ $# -lt 1 ]; then
    usage
    exit 2
  fi
  if [ "$1" = "--all" ]; then
    verify_all
  else
    local arg
    for arg in "$@"; do
      verify_package "$arg"
    done
  fi
  summary_and_exit
}

main "$@"
