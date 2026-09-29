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
`check:files` (after the build, so the generated bundles exist to measure) →
`verify` (per-project `verify` targets + the root contract gates) →
`deps:check`. CI runs the same targets per affected project.

### The Nx cache in a worktree

A cached task stores its verdict *and* the files its target declares as
`outputs`; `inputs` alone keys the verdict on the source and saves nothing else.
`targetDefaults.build` therefore declares `{projectRoot}/lib` — the directory
every `tsc`/`tsdown`/Typert build in this workspace emits into, and the one the
26 plugins resolve `@yadsh/*` type declarations through. Without it a replayed
`build` reports `Successfully ran target build for 31 projects` over a tree with
no `lib/`, and the next `typecheck` fails on `TS2307` in code the lane never
touched; `scripts/repo-config.test.mjs` replays a build in a throwaway workspace
so that regression cannot come back quietly. `test`, `typecheck`, `lint` and
`verify` stay without `outputs` on purpose — they emit nothing a later task
reads, and declaring an output for them would have the cache overwrite files it
does not own.

The cache directory is shared across git worktrees by design: Nx resolves it to
the main clone's `.nx/cache` for every worktree (`getMainWorktreeRoot` in
`node_modules/nx/dist/src/utils/cache-directory.js`), so a lane can replay
another lane's run — the recorded terminal output of a foreign worktree is what
`pnpm build` prints on such a hit. Three consequences for a lane: read the
per-task lines rather than the run summary, because `.nx/cache/run.json` is one
file for all worktrees and a concurrent `run-many` overwrites it; `nx reset`
clears the cache for every worktree, not just yours; and `cache.directory` stays
out of `nx.json`, because Nx reads that property from the *main clone's*
checkout, so pinning it here would silently follow whichever branch that
checkout happens to hold.

## Gate map

| Gate | Command | Asserts |
| --- | --- | --- |
| Dependency boundaries | `pnpm deps:check` (`scripts/check-dependencies.sh`) | Plugins may depend on shared packages, never the reverse; DSH runtime packages are peers, not dependencies; no cross-package relative imports; a plugin→plugin edge only if `plugin-dependency-allowlist.json` declares it with a reason (§27.11); a range a named catalog holds is declared through the catalog, peers excepted, and the remaining literal ranges are listed as advice so a shared range staying literal is a seen decision (§27.12) |
| Package hygiene | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every plugin exposes the canonical `check`/`verify`/`prepack` contract, uses pnpm, and only calls declared local scripts; every publishable package declares `compatibility.json`, `cordis.patch.yml`, `LICENSE`, `README.md`; `types` points at a standard `lib/` layout; every `.nx/version-plans/*.md` file parses the way Nx reads it (front-matter fence, known package, valid bump, changelog message); a version plan naming the qa-surface project requires a curated entry in `QaChangelog.tsx` whose `version:` is exactly the version those plans bump to (`AGENTS.md` §QA surface release notes owns the rule); a plugin declaring `dsh.client` keeps a script that asserts its full package name, and a plugin registering a configuration card (`settings.plugin.item` or, after the `0.1.7` slot rename, `plugins.row.config`; a card that stays on `settings.plugins.tab` counts when its sources carry the shell) keeps a script that runs the card contract |
| Discoverability | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | Every publishable manifest carries canonical monorepo metadata (`repository.directory`, `homepage`, `bugs.url`), a description naming DeepSeek Harness/DSH, and the canonical keyword set plus feature words; the root `plugins.json` catalog and the README package table match the workspace manifests — the manifest lists published packages, each with the `kind` whose install contract its `install` command honors (`plugin` is registered on a profile with `dsh plugin add`, `library` is consumed as a dependency with `pnpm add`), the README table also documents private build tooling and carries that kind per row (`pnpm plugins:manifest` regenerates both); `plugins.json` additionally validates against `docs/plugins.schema.json`, whose `kind` enum rejects a third value, and unknown schema keywords fail the gate instead of silently skipping the check |
| Published content | `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) | A tarball carries the runtime, the bundle patch, compatibility data, legal notices, the README, and the images it embeds — never specs, changelogs, roadmaps, design docs, integration notes, or README translations; every relative link in a published README resolves inside the tarball, so the package page shows no dead links |
| Logging contract | `pnpm verify:logging` (`scripts/verify-plugin-logging.mjs`) | Plugins write logs through `@yadsh/dsh-plugin-log` conventions (see [PLUGIN_LOGGING.md](PLUGIN_LOGGING.md)) |
| Button names | `pnpm verify:a11y` (`scripts/verify-button-names.mjs`) | Every button a plugin or shared client package renders under `src/` carries an accessible name — `aria-label`, `aria-labelledby`, `title`, or children that can produce text — so a screen reader and `getByRole("button", { name })` can address it; an icon-only button is reported as `path:line` |
| Test ids | `pnpm verify:testids` (`scripts/verify-testids.mjs`) | Every `data-testid` a plugin or shared client package renders under `src/` follows the epic #453 convention: the attribute is spelled exactly `data-testid` (a `data-test-id` is an address `getByTestId` never resolves), a value the site decides is ASCII kebab-case with a zone in front of it, and one value is owned by one file of the workspace — the zone is what keeps two plugins apart once they render into one page, so the collision read does not stop at the package edge. A site is where the value reaches the attribute, which is one step wider than the attribute: a card that renders its fields through its own controls names the slot in the `testId` prop it passes down, and those values carry the same rules (the prop's own name is not read as a misspelling of the attribute's). The exceptions are read the way a static file can read them: a value repeated inside one file is how one node names its mutually exclusive states (`qa-message-image` at loading, broken and loaded), a value composed at runtime — `${testIdZone}-empty`, `props.testId` — is asked only about the text no caller can change, so its prefix and its collisions stay this gate's blind spot, and a comment renders nothing, so the doc example and the note about an old spelling are read as no site at all. Cyrillic, an all-digit segment and a segment naming a person the workspace's own manifests declare as an author are refused (an author line contributes its name and its login, not the host of its address): `AGENTS.md` §No internal identifiers covers these strings because they ship in the published bundle and name the node in every test screenshot |
| Client bundle | per-plugin `verify` chain (`plugins/*/scripts/verify-client-bundle.mjs`, or bundle asserts inside `verify-package.mjs`) | Built `lib/client.js` registers under the plugin's **full npm package name** and stays a classic ModuleLoader script rather than an ESM module; the React family the shell provides is its only external — everything else the client uses is inlined (see [ARCHITECTURE.md](ARCHITECTURE.md#host-process-vs-browser-client)). A plugin may run these asserts as a separate `verify:client` script (`dsh-doc-impact` does); the other client bundles carry them inside `verify:package`. Either way the integration URL is `/plugins/<full-package-name>/client.js` |
| Configuration card | per-plugin `verify` chain (`clientBundle.cardContract`, or a direct call to `scripts/verify-plugin-card-contract.mjs`) | Every bundle that renders the settings-card shell — the 12 plugins registering a `settings.plugin.item` card and the two `settings.section` pages that reuse the shell — carries the canonical shell CSS, the inline chevron SVG, the rendered open-state class pair and the header's `aria-expanded`; font-glyph chevrons, non-canonical shell tokens and the plugin's own legacy shell classes fail the gate. `@yadsh/dsh-plugin-kit` runs the same contract over the shell modules every plugin bundle inlines, so the canonical text is checked at its source too. A plugin without a card owes nothing here |
| Packed package | per-plugin `verify:package` (`plugins/*/scripts/verify-package.mjs`) | Static asserts only: manifest fields, `files` allowlist, exports exist on disk, no `workspace:`/`catalog:` leakage. Packing and the clean-room import smoke live in `pnpm tarball:verify`, not here |
| Shared package | per-package `verify` (`packages/*/scripts/verify-package.mjs`, through `@yadsh/dsh-plugin-scripts/run-verify-package`) | Static asserts only, on the two things packing cannot show: `main`/`types` name the same file as the root `exports` entry, and every published range resolves for a registry consumer (a `workspace:` range never names a missing or private member, a `catalog:` range never names a member, a member is never declared as a plain range). Plus the manifest contract that carries over from a plugin: declared subpaths built, `files` allowlist, no `dsh.client` surface. `README.md` and `LICENSE` are pinned on disk as well: npm ships those two whatever the `files` list says, so the only way one misses a tarball is being gone from the package, and the tarball gate that asks for them by name (gate 4b) runs only for plugins. Where a package's runtime surface is what consumers lean on beyond its types, its gate pins that surface too — plugin-kit's client card surface and the shell contract, audit-core's schema and producer, audit-ui's sanitizer and token-only sheet. The gate does not pack — whether the tarball ships each export and leaks no protocol is `pnpm tarball:verify`, which CI runs for every publishable project. `pnpm verify:packages` rejects a publishable shared package whose `verify` script disappeared, and reads the call itself so a gate that stopped passing either option fails there instead of passing while this row describes a check nobody runs |
| Tarball (repo level) | `pnpm tarball:verify` (`scripts/tarball-verify.sh`) | Packs each publishable plugin and shared package and reads the artifact: every `exports`/`main`/`types` entrypoint present, no `workspace:`/`catalog:` range left unresolved, then installs the tarball into a clean consumer project and smoke-imports it; an install the registry or the network broke mid-flight is retried, so a fetch that fails for the moment is not reported as an uninstallable package |
| Repo tooling tests | `pnpm test:release` (`scripts/*.test.mjs`) | The CI/release scripts themselves are regression-tested with `node --test`, and so are the repository's own config files — the blame list, the `lint` cache key and the `build` cache outputs, the last two proven by running `nx` in a throwaway workspace built from `nx.json`, and the three blocks `SPEC.md` copies verbatim — the `release` configuration of §14, the `prepare` gate list of §17, the command excerpt of §22 — compared against `nx.json`, the `prepare` job of `.github/workflows/ci.yml` and the root `package.json`. Each copy is cut from the section its heading names, so a block that left its section is a miss rather than a match, and §20's local tag census (no `name@version` tag reachable from the checkout) is re-run alongside them — which is what stops the Draft from drifting from the runbook in silence |
| File size budget | `pnpm check:files` (`scripts/check-file-budget.mjs`) | No source file under `plugins/*/src`, `packages/*/src`, `plugins/*/scripts`, or `packages/*/scripts` is over its line budget, no test file under `plugins/*/tests` or `packages/*/tests` is over the tighter one, and no generated bundle under a package's `lib/` ran away; the repository's own root `scripts/` is outside the scope, and the thresholds and the allowlist are [below](#file-size-budget) |
| Test coverage (a measurement, not a gate) | `pnpm test:coverage` | V8-instrumented percentages per package over its `src` tree, printed and written to `<package>/coverage/coverage-summary.json` (see [COVERAGE.md](COVERAGE.md) for the last committed snapshot). It asserts nothing: there is no threshold to fail, because a red floor competes with the per-file size budget and buys tests that assert nothing. Read it before a refactor to find the untested corner, not to close a pull request |
| Version plans | `pnpm release:check` (`scripts/check-release-plans.mjs`) | Every publishable release project whose commits no release tag covers yet is named by a committed version plan; a project a tag already covers is not asked for one (see below) |

### File size budget

Nothing measured a file, so single-file modules grew a few hundred lines a week
and every commit was small enough to review on its own. The gate counts lines the
way `wc -l` does — a number it prints is a number you can reproduce by hand — and
holds each file to the budget of its kind:

| Kind | Scope | Warn | Fail |
| --- | --- | --- | --- |
| source | `plugins/*/{src,scripts}`, `packages/*/{src,scripts}` | 1200 | 1400 |
| test | `plugins/*/tests`, `packages/*/tests` | 700 | 900 |
| generated bundle | `lib/client.js`, `lib/typert.host.js` and `lib/typert.remote-client.js` in a package | 80000 | 100000 |

**Scope boundary.** The gate walks package directories only, so the repository's
own `scripts/` is not measured — even though `scripts/package-hygiene.test.mjs`
(1138 lines) and `scripts/release-workflow.test.mjs` (1064) already sit past the
test budget their counterparts under `plugins/*/tests` would be held to. Naming
those files as debt is a separate card; until it lands, do not read this row as
coverage of root `scripts/`.

Every number is a line count, deliberately: bytes are a different measurement,
and a bundle that swallowed a dependency tree looks the same in bytes as one that
simply ships a wide surface. A byte budget is its own card, not an extra key here.

The generated bundle band is a tripwire rather than a size goal — the largest
artifact today is the qa-surface client at 66 745 lines, measured after
`pnpm -r build` — and it only measures anything after a build, which is why
`check` runs `check:files` after `build`. CI runs it in both places: `prepare`
checks the source and test bands on a checkout that has no `lib/` in it, where
the bundle rows measure nothing and the run says so in its own output
(`0 generated artifacts`), and the project job runs the same gate right after it
has built that project, which is where a bundle that swallowed a dependency tree
costs the run. `verify` still asserts the identity and self-containedness of each
built bundle. A warning costs a report line and never the run; one line per kind
is printed, so a green run stays readable.

**Allowlist.** `fileBudgetAllowlist` in the script names the files already over
their hard budget, each with the reason for its exemption on the same line, and a
green run prints one `allowlisted: <path> — <reason> (<lines> lines)` line per
entry. Without the list the gate would be red on the commit that introduces it,
and a check that is red gets switched off; without the printed line an exemption
that nobody sees reads as coverage after half a year. Two classes are in it:

- sources that were over 1400 lines before the gate landed — the qa-surface type,
  index, admin, account and client modules, and the integrations index. They leave
  one by one as their refactor card splits them, and four already did: the
  integrations operator card, back within budget after the provider-core split, the
  session-scope client, whose file that split deleted, and the browser session
  manager and the authenticated-fetch client sections, each now a barrel over the
  module directory that took its body.
- `plugins/dsh-qa-integrations/scripts/verify-package.mjs`, an assertion list run
  over the built bundle and the packed tarball. Its length tracks the shipped
  surface rather than a module design, which is exactly the case the source budget
  was not written for, so it is exempted by name and reason instead of by a rule.

Growing an allowlisted file is neither an error nor a warning: the gate exists to
stop the next 400 lines, not to re-litigate the last 2000, and those paths belong
to the refactor cards — but the file stays named in the output while it is on the
list. The list only shrinks — an entry whose file no longer exists fails the run,
and one that came back within budget is reported so it can be dropped. No test
file is exempted, because nothing is over 900 and a test that long is a missing
helper, not a missing exemption. Adding a path, or raising a threshold to fit one,
is the failure mode this section documents rather than the way out.

## What gates cannot prove

Nothing above dials a real service, so three failures stay invisible to every
one of them: an address that does not answer, a credential the product refuses,
and — the expensive one — a provider that speaks a different API than the
instance serves. Those are covered by
[MANUAL_VERIFICATION.md](MANUAL_VERIFICATION.md), which carries the probe
command (`scripts/probe-provider.mjs`), the per-provider acceptance steps, the
negative cases, the order of work for adding a provider, and the checklist for
adding a second product to a provider.

Nothing above opens the page either. A surface that overflows its container, a
settings card that never appears for a non-loopback browser, a card state that
does not match the first-party shell, and a client bundle that dies on mount all
pass the whole gate set: the bundle gates assert its identity and
self-containedness, the card-contract gate asserts the shell's text, and neither
renders it. The proof is a measurement and a screenshot of each state the shell
contract names, beside a first-party card, on a stand — the steps are in the
`create-plugin` skill's `client-side` reference (§Proving the card you just
registered, §Proving a UI change beyond the gates), and the round it belongs to
is recorded under [Stand acceptance](#stand-acceptance). That pointer is a name
rather than a file link on purpose: nothing in the gate set resolves a link from
`docs/**` into `.agents/**`, so such a link rots silently whenever a skill is
reorganized, while a name still says which skill to open.

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
tooling tests and lint, `check:files`, `verify:logging`, `verify:a11y`,
`verify:testids`, and `verify:packages` run once before the matrix. `pnpm check`
covers `lint`, `format`, `typecheck`, `test`, `build`, `check:files`, `verify`,
and `deps:check` — it does not run `tarball:verify` or
`release:check`; run those separately before pushing. `pnpm affected:check`
mirrors the per-project CI targets locally.

`check:files` runs twice, for two different reasons. In `prepare`, on a checkout
with no build output, it holds the source and test budget of every file in the
pull request to its line limit; the generated bundle band is inert there, and the
step reports `0 generated artifacts` instead of pretending to have measured them.
In the project job, right after that project has been built, it measures the
bundles that build just wrote — the runaway tripwire that a client bundle
swallowed a dependency tree is pulled there rather than left to whoever happens
to rebuild locally. Each project's own `verify` target still asserts the identity
and self-containedness of the bundle it built, and `pnpm check` reaches the same
bundle band after `build`.

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
each round is recorded by. Those are roles, not paths: the kit's file names are
listed once, in the `release-plugins` skill §1b, and `qa-stand-run` is the route
a single plugin change takes to the same pass. Run that pass on the test stand
before moving the deployment's plugin list, and repeat the smoke pass on the
deployment itself.
