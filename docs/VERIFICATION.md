# Verification runbook

What runs, where, and what each gate actually asserts. The plugin-facing rules
behind these gates live in [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) and
[AGENTS.md](../AGENTS.md); this page is the operator's map.

## Local one-shot

```bash
pnpm check
```

runs, in order: `lint` (workspace tooling + per-project eslint) → `format` →
`typecheck` → `test` (repo-script tests, then per-project Vitest) → `build` →
`verify` (per-project `verify` targets + the two root contract gates) →
`deps:check`. CI runs the same targets per affected project.

## Gate map

| Gate | Command | Asserts |
| --- | --- | --- |
| Dependency boundaries | `pnpm deps:check` (`scripts/check-dependencies.sh`) | Plugins may depend on shared packages, never the reverse; DSH runtime packages are peers, not dependencies; no cross-package relative imports |
| Package hygiene | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every plugin exposes the canonical `check`/`verify`/`prepack` contract, uses pnpm, and only calls declared local scripts; every publishable package declares `compatibility.json`, `cordis.patch.yml`, `LICENSE`, `README.md`; `types` points at a standard `lib/` layout; every `.nx/version-plans/*.md` file parses the way Nx reads it (front-matter fence, known package, valid bump, changelog message); a version plan naming the qa-surface project requires a newer curated entry in `QaChangelog.tsx`; a plugin declaring `dsh.client` keeps a script that asserts its full package name, and a plugin registering a `settings.plugin.item` card keeps a script that runs the card contract |
| Discoverability | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every publishable manifest carries canonical monorepo metadata (`repository.directory`, `homepage`, `bugs.url`), a description naming DeepSeek Harness/DSH, and the canonical keyword set plus feature words; the root `plugins.json` catalog matches the workspace manifests (`pnpm plugins:manifest` regenerates it) |
| Published content | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | A tarball carries the runtime, the bundle patch, compatibility data, legal notices, the README, and the images it embeds — never specs, changelogs, roadmaps, design docs, integration notes, or README translations; every relative link in a published README resolves inside the tarball, so the package page shows no dead links |
| Logging contract | `pnpm verify:logging` (`scripts/verify-plugin-logging.mjs`) | Plugins write logs through `@yadsh/dsh-plugin-log` conventions (see [PLUGIN_LOGGING.md](PLUGIN_LOGGING.md)) |
| Client bundle | per-plugin `verify` chain (`plugins/*/scripts/verify-client-bundle.mjs`, or bundle asserts inside `verify-package.mjs`) | Built `lib/client.js` registers under the plugin's **full npm package name** and is self-contained (no bare external imports). Five plugins run these asserts as a separate `verify:client` script; the other client bundles carry them inside `verify:package` |
| Configuration card | per-plugin `verify` chain (calling `scripts/verify-plugin-card-contract.mjs`) | The 10 of 15 client bundles that register a `settings.plugin.item` card contain the canonical card shell CSS + chevron SVG in the built bundle; plugins without a card owe nothing here |
| Packed package | per-plugin `verify:package` (`plugins/*/scripts/verify-package.mjs`) | Static asserts only: manifest fields, `files` allowlist, exports exist on disk, no `workspace:`/`catalog:` leakage. Packing and the clean-room import smoke live in `pnpm tarball:verify`, not here |
| Tarball (repo level) | `pnpm tarball:verify` (`scripts/tarball-verify.sh`) | Installs every packed tarball into a clean consumer project and smoke-imports it |
| Repo tooling tests | `pnpm test:release` (`scripts/*.test.mjs`) | The CI/release scripts themselves are regression-tested with `node --test` |
| Version plans | `pnpm release:check` (`scripts/check-release-plans.mjs`) | Every publishable release project whose commits no release tag covers yet is named by a committed version plan; a project a tag already covers is not asked for one (see below) |

## CI vs local

`.github/workflows/ci.yml` selects affected Nx projects once, then fans their
`lint`, `typecheck`, `test`, `build`, `verify`, and publishable-tarball checks
out through a bounded GitHub Actions matrix. Repository-wide `deps:check`,
tooling tests and lint, `verify:logging`, and `verify:packages` run once before
the matrix. `pnpm check` covers `lint`, `format`, `typecheck`, `test`,
`build`, `verify`, and `deps:check` — it does not run `tarball:verify` or
`release:check`; run those separately before pushing. `pnpm affected:check`
mirrors the per-project CI targets locally.

The PR-only version-plan check compares each publishable release project
against the newest release tag its history can reach — one `release/<date>` tag
per release run — rather than against the base alone. A release dispatched
against a branch applies that branch's plans, deletes them, and leaves the
released projects differing from the base, so a base-relative check would
report an applied release as missing. Changes made after such a release still
need a plan: the tag covers the work it released, not what follows it.

## Release flow

See [RELEASING.md](RELEASING.md). Publishing happens exclusively through the
GitHub release workflow with npm Trusted Publishing — there are no npm tokens
and no tag-driven releases.
