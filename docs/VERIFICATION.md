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
| Discoverability | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every publishable manifest carries canonical monorepo metadata (`repository.directory`, `homepage`, `bugs.url`), a description naming DeepSeek Harness/DSH, and the canonical keyword set plus feature words; the root `plugins.json` catalog and the README package table match the workspace manifests — the manifest lists published packages, the README table also documents private build tooling (`pnpm plugins:manifest` regenerates both); `plugins.json` additionally validates against `docs/plugins.schema.json`, and unknown schema keywords fail the gate instead of silently skipping the check |
| Published content | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | A tarball carries the runtime, the bundle patch, compatibility data, legal notices, the README, and the images it embeds — never specs, changelogs, roadmaps, design docs, integration notes, or README translations; every relative link in a published README resolves inside the tarball, so the package page shows no dead links |
| Logging contract | `pnpm verify:logging` (`scripts/verify-plugin-logging.mjs`) | Plugins write logs through `@yadsh/dsh-plugin-log` conventions (see [PLUGIN_LOGGING.md](PLUGIN_LOGGING.md)) |
| Button names | `pnpm verify:a11y` (`scripts/verify-button-names.mjs`) | Every button a plugin or shared client package renders under `src/` carries an accessible name — `aria-label`, `aria-labelledby`, `title`, or children that can produce text — so a screen reader and `getByRole("button", { name })` can address it; an icon-only button is reported as `path:line` |
| Client bundle | per-plugin `verify` chain (`plugins/*/scripts/verify-client-bundle.mjs`, or bundle asserts inside `verify-package.mjs`) | Built `lib/client.js` registers under the plugin's **full npm package name** and is self-contained (no bare external imports). A plugin may run these asserts as a separate `verify:client` script (`dsh-doc-impact` does); the other client bundles carry them inside `verify:package`. Either way the integration URL is `/plugins/<full-package-name>/client.js` |
| Configuration card | per-plugin `verify` chain (`clientBundle.cardContract`, or a direct call to `scripts/verify-plugin-card-contract.mjs`) | Every bundle that renders the settings-card shell — the 12 plugins registering a `settings.plugin.item` card and the two `settings.section` pages that reuse the shell — carries the canonical shell CSS, the inline chevron SVG, the rendered open-state class pair and the header's `aria-expanded`; font-glyph chevrons, non-canonical shell tokens and the plugin's own legacy shell classes fail the gate. A plugin without a card owes nothing here |
| Packed package | per-plugin `verify:package` (`plugins/*/scripts/verify-package.mjs`) | Static asserts only: manifest fields, `files` allowlist, exports exist on disk, no `workspace:`/`catalog:` leakage. Packing and the clean-room import smoke live in `pnpm tarball:verify`, not here |
| Tarball (repo level) | `pnpm tarball:verify` (`scripts/tarball-verify.sh`) | Installs every packed tarball into a clean consumer project and smoke-imports it; an install the registry or the network broke mid-flight is retried, so a fetch that fails for the moment is not reported as an uninstallable package |
| Repo tooling tests | `pnpm test:release` (`scripts/*.test.mjs`) | The CI/release scripts themselves are regression-tested with `node --test` |
| Version plans | `pnpm release:check` (`scripts/check-release-plans.mjs`) | Every publishable release project whose commits no release tag covers yet is named by a committed version plan; a project a tag already covers is not asked for one (see below) |

## What gates cannot prove

Nothing above dials a real service, so three failures stay invisible to every
one of them: an address that does not answer, a credential the product refuses,
and — the expensive one — a provider that speaks a different API than the
instance serves. Those are covered by
[MANUAL_VERIFICATION.md](MANUAL_VERIFICATION.md), which carries the probe
command (`scripts/probe-provider.mjs`), the per-provider acceptance steps, the
negative cases, and the checklist for adding a second product to a provider.

Two files [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md) §4.1 lists are
**not** gated, deliberately: `tsdown.config.ts`, which seven host-only plugins
do not need (their `lib/` comes from `tsc` alone), and a local
`vitest.config.ts`, which `dsh-ui-repair` does without (the shared preset plus a
`// @vitest-environment jsdom` pragma in the files that need a DOM). A gate on
their presence would reject packages that are correct as they stand.

## CI vs local

`.github/workflows/ci.yml` selects affected Nx projects once, then fans their
`lint`, `typecheck`, `test`, `build`, `verify`, and publishable-tarball checks
out through a bounded GitHub Actions matrix. Repository-wide `deps:check`,
tooling tests and lint, `verify:logging`, `verify:a11y`, and `verify:packages`
run once before the matrix. `pnpm check` covers `lint`, `format`, `typecheck`, `test`,
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

### Stand acceptance

Gates verify the code, not a deployment: a tool that exists but is out of the
conversation's reach, an expert whose tool policy names tools the runtime
refuses, a reviewer whose service is missing, or a model pin that no longer
matches all pass lint, typecheck, test and verify. A wave that will be deployed
is therefore accepted on a stand as well. The deployment kit carries the manual
playbooks — smoke after every deploy, wave acceptance with a row per changed
package, and a refusal-to-cause reference — together with the evidence collector
each round is recorded by. Run that pass on the test stand before moving the
deployment's plugin list, and repeat the smoke pass on the deployment itself.
