# Pre-flight: what to run, and what each check actually proves

## The sequence

```bash
# 1. Where am I, and is this ref meant to be pushed?
git status --short
git rev-parse --abbrev-ref HEAD
git log --oneline -5

# 2. Plans exist, are committed, and are parseable
pnpm release:check
node scripts/verify-package-hygiene.mjs --version-plans-only

# 3. Everything, uncached
NX_SKIP_NX_CACHE=true pnpm check

# 4. The gates pnpm check does not include
pnpm test:release
pnpm tarball:verify

# 5. Predict the wave (optional, cheap)
node scripts/workspace-packages.mjs --format=tsv > "$TMPDIR/rows.tsv"
node scripts/publish-release.mjs --check --tsv="$TMPDIR/rows.tsv"
```

## Coverage

| Command | Covers | Does **not** cover |
| --- | --- | --- |
| `pnpm check` | `lint`, `format`, `typecheck`, `test`, `build`, `verify` (→ `verify:packages`, `verify:logging`, per-package `verify`), `deps:check` | `tarball:verify`, `release:check`, the browser smoke |
| `pnpm test:release` | the release/CI workflow contracts: publish-before-push order, the fan-out, the plan gate, the publication gate, wave notes | whether the workflow actually runs |
| `pnpm release:check` | a committed plan for every publishable project whose newest reachable release tag does not cover its commits | uncommitted work — it reads commits |
| `pnpm tarball:verify` | gates 1–7 on the packed tarball, including `exports` vs the real build and "no `workspace:`/`catalog:` leaks into the manifest" | anything about the registry |
| `pnpm verify:packages` | canonical metadata, `files` allowlist, plan validity, `plugins.json` drift, qa-surface changelog coupling, card/bundle contracts | runtime behaviour |

`pnpm check` runs `lint` and `format` before it typechecks or tests anything, so
one unformatted file fails the whole run before a single test executes. Format
your own files; a red `format` caused by somebody else's uncommitted edit is not
yours to fix.

## Proving the gates are honest

Three ways a green run lies, all of them observed here:

- **The Nx cache.** Tasks have no declared `outputs`, so a cache hit replays
  stale output — including output from a failing task. Only
  `--skip-nx-cache` / `NX_SKIP_NX_CACHE=true` is evidence.
- **Build output in the tree.** A verifier or typecheck that reads `lib/` sees
  artifacts a clean checkout will not have. Emulate one:

  ```bash
  rm -rf plugins/*/lib packages/*/lib
  pnpm nx run-many -t typecheck --skip-nx-cache
  ```

  Do this before trusting a typecheck that depends on generated `.d.ts` files;
  the shims used when `lib/` is absent are exactly what breaks in CI.
- **The retry.** Nx retries a failed task, labels it flaky and passes. A test
  that fails under parallel load and passes isolated is still a defect until you
  can say why the load matters — reproduce it (`pnpm vitest run <file>` in a
  loop, or the whole package repeatedly) before dismissing it.

## Environment traps that look like your bug

- `node --test scripts/…` and `npm run test:release` both fail on
  `npm_execpath`; only `pnpm test:release` is valid.
- Node resolves `/tmp/...` to `D:\tmp` (a path that does not exist) on Windows.
  Use `$TMPDIR` / `os.tmpdir()`.
- A run in a second checkout or worktree needs `NX_DAEMON=false
  NX_SKIP_NX_CACHE=true`, or the daemon executes work from another checkout and
  reports success for it.
- A fresh worktree has no `packages/*/lib`, and `nx` exits 0 without producing
  it. Build the shared packages with their own scripts (`cd packages/plugin-log
  && pnpm run build`) before typechecking anything that imports them, or accept
  `TS2307` as the honest answer.
- `.gitattributes` pins LF. A checkout created from a branch predating it holds
  CRLF and fails tests for reasons unrelated to the release.

## Registry checks that do not lie

- Per-version document, not the package document:
  `https://registry.npmjs.org/@yadsh%2F<name>/<version>`. The abbreviated
  packument is served through a CDN cache and reports a fresh version as missing
  for minutes.
- `dist.attestations` present = published by the workflow. Absent = published by
  hand, and the wave will treat it as adopted rather than its own.
- An install check is the only thing that proves a wave is consumable:
  `node scripts/publish-release.mjs --verify-install --tsv=<rows>` runs a real
  `npm install <name>@<version> --dry-run` per package and retries while the
  registry catches up.
