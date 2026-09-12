# Verification runbook

What runs, where, and what each gate actually asserts. The plugin-facing rules
behind these gates live in [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) and
[AGENTS.md](../AGENTS.md); this page is the operator's map.

## Local one-shot

```bash
pnpm check
```

runs, in order: `lint` (workspace tooling + per-project eslint) → `typecheck`
→ `test` (repo-script tests, then per-project Vitest) → `build` → `verify`
(per-project `verify` targets + the two root contract gates). CI runs the same
targets per affected project.

## Gate map

| Gate | Command | Asserts |
| --- | --- | --- |
| Dependency boundaries | `pnpm deps:check` (`scripts/check-dependencies.sh`) | Plugins may depend on shared packages, never the reverse; DSH runtime packages are peers, not dependencies; no cross-package relative imports |
| Package hygiene | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every publishable package declares `compatibility.json`, `cordis.patch.yml`, `LICENSE`, `README.md`; `types` points at a standard `lib/` layout; every `.nx/version-plans/*.md` file parses the way Nx reads it (front-matter fence, known package, valid bump, changelog message) |
| Logging contract | `pnpm verify:logging` (`scripts/verify-plugin-logging.mjs`) | Plugins write logs through `@yadsh/dsh-plugin-log` conventions (see [PLUGIN_LOGGING.md](PLUGIN_LOGGING.md)) |
| Client bundle | per-plugin `verify:client` (`plugins/*/scripts/verify-client-bundle.mjs`) | Built `lib/client.js` registers under the plugin's **full npm package name**, is self-contained (no bare external imports), and contains the canonical card shell CSS + chevron SVG |
| Packed package | per-plugin `verify:package` (`plugins/*/scripts/verify-package.mjs`) | Manifest fields, `files` allowlist, exports exist on disk, no `workspace:`/`catalog:` leakage, pack + clean-room import smoke |
| Tarball (repo level) | `pnpm tarball:verify` (`scripts/tarball-verify.sh`) | Installs every packed tarball into a clean consumer project and smoke-imports it |
| Repo tooling tests | `pnpm test:release` (`scripts/*.test.mjs`) | The CI/release scripts themselves are regression-tested with `node --test` |
| Version plans | `pnpm release:check` | Every user-facing change in a PR is covered by a version-plan entry; a branch that already ran its own release is exempt (see below) |

## CI vs local

`.github/workflows/ci.yml` selects affected Nx projects once, then fans their
`lint`, `typecheck`, `test`, `build`, `verify`, and publishable-tarball checks
out through a bounded GitHub Actions matrix. Repository-wide `deps:check`,
tooling tests and lint, `verify:logging`, and `verify:packages` run once before
the matrix. Local `pnpm check` is the superset you should run before pushing;
`pnpm affected:check` mirrors the per-project CI targets locally.

The PR-only version-plan check is skipped when release tags exist that only the
branch carries, which means a release was dispatched against the branch itself
instead of `main`. That release applied those plans and deleted them, so the
check would find nothing to read while the released projects stay touched
relative to the base. Changes made after such a release still deserve a plan;
the exemption only stops the check from reporting an applied release as
missing.

## Release flow

See [RELEASING.md](RELEASING.md). Publishing happens exclusively through the
GitHub release workflow with npm Trusted Publishing — there are no npm tokens
and no tag-driven releases.
