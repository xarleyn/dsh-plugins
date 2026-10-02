# DSH 0.1.7-rc migration map

Status: **investigation complete for both `rc.1` and `rc.2`; the cutover is under
way.** The repository has moved onto the `0.1.7-rc.2` baseline — the named
catalogs first (§1 step 1), then the mechanical metadata wave (§6); see
[COMPATIBILITY.md](COMPATIBILITY.md). Sections 1–7 are the `rc.1` pass; sections
8–13 are the `rc.1 → rc.2` delta, a fresh trial bump measured at `rc.2`, and the
per-package work breakdown. Read 8–13 as the current truth: everywhere the two
disagree, `rc.2` wins, and §1–§7 carry `[rc.2 fix]` markers on the items this
pass disproved.

The `rc.2` catalog bump **is committed** (§7 step 2, §12 item 1): the tree still
carries the build and typecheck redness §9 measured — #509 re-measured it at 13
failed build targets and 293 typecheck errors across 17 projects, against a green
baseline control in the same worktree — and §10's D1 still has no answer, which
gates the card rewrite in 12 of the 24 affected packages. The §6 metadata wave was
then run **ahead of** the per-package content migration, against §7 step 8's
ordering, on the epic's decision: one card edits the version metadata of every
package once, instead of every package card editing the same files again.
Consequence to keep in view: `testedReleases` and the "tested against" lines in
plugin READMEs are an evidence claim, and for the packages still red in §9 that
claim is currently asserted rather than measured — the content cards owe it a real
run.

Method, pass 1: five parallel investigations over the harness sources at the
`dsh-v0.1.7-rc.1` tag (a local checkout of the DeepSeek Harness repository), then
an actual trial bump of this repository's catalogs to the target versions with a
real `pnpm install`, `nx build` and `pnpm -r typecheck`.

Method, pass 2: the same shape against `dsh-v0.1.7-rc.2` — five parallel slice
investigations over the `rc.1..rc.2` diff, plus a trial bump run in this
worktree with `pnpm install`, `nx run-many -t build`, `pnpm -r typecheck`,
`pnpm -r --no-bail typecheck` and `npx nx run-many -t test`, against a
cache-busted baseline control. §13 records the exact commands.

Every claim below is tagged:

- **[verified]** — read off the installed target type declarations, or produced
  by the compiler during a trial bump.
- **[source]** — read off the harness source at the tag, not exercised at runtime.
- **[inferred]** — reasoned from the sources; a running host or one more read
  would settle it.
- **[unverified]** — needs a running host to settle.

## 1. Pre-flight (all green)

- **[verified]** `0.1.7-rc.1` is published to the registry
  (`npm view @deepseek-ai/dsh versions` ends `0.1.7-alpha.1, 0.1.7-alpha.2,
  0.1.7-rc.1`). This was the Phase 0 blocker in the earlier plan: without it no
  manifest version may move, because `catalog:dsh-dev` and the
  `smoke-packed-dsh.mjs` scripts install from the registry.
  **[verified] `0.1.7-rc.2` is published too**, and every catalog key resolves
  at it except the one named below.
- **[verified]** Bumping both catalogs and running `pnpm install` resolves and
  links cleanly; `@deepseek-ai/dsh-settings@0.1.7-rc.1` and
  `@deepseek-ai/cordis@4.0.4` land in the isolated store. The same holds at
  `rc.2`: `pnpm install` exits 0 in 20 s with the catalogs moved and nothing else
  edited (§9.1).
- **[verified]** Of the 48 `@deepseek-ai/*` catalog entries, exactly **one no
  longer exists** at the target: `@deepseek-ai/dsh-agent-presets`. It was split
  into `@deepseek-ai/dsh-agent-preset` and `@deepseek-ai/dsh-agent-preset-registry`.
  Our two users of it (`dsh-preset-persona-editor`, `dsh-qa-surface`) need only
  the registry: it declares the `ctx.agentPresets` Context merge
  (`packages/preset/agent-preset-registry/src/index.ts:26`) and keeps the
  `./remote` subpath export. The rename is a plain
  `dsh-agent-presets` → `dsh-agent-preset-registry` across 9 references in 7
  files; all of them are `import type {}` anchors or `dsh.client.inject` entries,
  so there is no call-site work.
  **[verified] unchanged at `rc.2`** — still exactly one missing key, and the
  registry is still split the same way. **[verified]** the rename is **not
  separable from the bump**: `@deepseek-ai/dsh-agent-preset-registry@0.1.5-rc.2`
  does not exist, so the 9 references and the two catalogs must move in one
  commit.

[rc.2 fix] **[verified]** the counts in the next paragraph and in §6 were off by
one: `catalog:dsh` has **45** keys (43 with the `>=0.1.5-rc.2 <0.2.0` range plus
cordis and schemastery) and `catalog:dsh-dev` has **48** (46 pins plus the two
framework entries), measured with the parser in §13.

### Framework tier moves independently

The DSH family bumps in lockstep (`0.1.5-rc.2` → `0.1.7-rc.1`, 261 packages), but
the framework tier does **not** — it moves on its own schedule and must be
retargeted separately in both catalogs:

| Package | current | at 0.1.7-rc.1 | at 0.1.7-rc.2 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | `4.0.2` | `4.0.4` | `4.0.4` |
| `@deepseek-ai/schemastery` | `3.18.2` | `3.18.4` | `3.18.4` |
| `@deepseek-ai/cosmokit` (transitive) | `1.8.3` | `1.8.5` | `1.8.5` |

**[verified]** the tier **did not move between `rc.1` and `rc.2`**: the harness
vendors all three in-tree (`pnpm-workspace.yaml:19-20` `link:vendor/…`) and
`git diff --stat dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2 -- vendor` is empty; the
registry's latest is the same triple. So `rc.2` adds **no** new cordis or
schemastery breakage, and everything §5 says about `Schema<S,T,Mode>`,
`.volatile()` and `z.union` is an `0.1.5 → rc.1` delta that stays correct.

**[verified] new hazard this bump exposes, and it is ours, not the harness's.**
`pnpm install` at `rc.2` leaves **two** copies of the tier in the store
(`.pnpm` has both `schemastery@3.18.2` and `@3.18.4`, both `cosmokit@1.8.3` and
`@1.8.5`) because 16 DSH packages our catalogs never covered are still pinned at
`0.1.1-rc.2` and peer `schemastery: 3.18.2` exactly. That set is pre-existing —
`git show HEAD:pnpm-lock.yaml` already had 19 names at `0.1.1-rc.2` — but at
`0.1.5-rc.2` our own range `^3.18.2` coincided with theirs, so the tree had one
copy. Moving to `^3.18.4` splits it, and declaration emit then fails with
`TS2742: The inferred type of 'Config' cannot be named without a reference to
…/@deepseek-ai/schemastery` (3 occurrences, §9.3). Fix in the same catalog
commit: add the missing names to `catalog:dsh` / `catalog:dsh-dev`
(`dsh-invariants`, `dsh-storage`, `dsh-session-persistence`,
`dsh-session-projection`, `dsh-user-approval`, `dsh-sandbox-policy`,
`dsh-launch-environment`, `dsh-brand`, `dsh-subprocess`, `dsh-shell`,
`dsh-commands`, `dsh-authorization`, `dsh-file-reference`,
`dsh-host-directory-picker`, `dsh-session-title`, `dsh-agent-default-model`,
`dsh-tool-todo`) or collapse them with a root `pnpm.overrides`, so the tier is
single-copy. `pnpm install` also prints 10 × `unmet peer
@deepseek-ai/dsh-invariants@0.1.7-rc.2: found 0.1.1-rc.2` and similar for the
other sixteen — the same root cause, visible before the compiler.

## 2. The host now refuses incompatible plugins — and our `compatibility.json` is not the lever

**[source]** Two changes land just before the target tag:
`feat(plugins): enforce DSH peer compatibility with exact exemptions (#4980)` and
`fix(plugins): deny incompatible bundles and clarify compatibility refusals (#5061)`,
implemented in `packages/boot/app-boot/src/{plugin-compatibility,profile-compatibility,compatibility-preflight}.ts`.

Behaviour, which matters for our users more than for our build:

- The Host checks a plugin's **`peerDependencies`** whose key is `@deepseek-ai/dsh`
  or `@deepseek-ai/dsh-*`, against its own runtime version, with
  `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`.
- **`@deepseek-ai/cordis` and `@deepseek-ai/schemastery` peers are ignored** by
  this gate, and **`engines.dsh` is never consulted**
  (`packages/boot/app-boot/README.md:52`). A stale cordis pin therefore is not
  denied — it fails in a harder-to-diagnose way.
- An ordinary profile row that fails is detached with `disabled: true`; a
  **bundle** whose own `package.json` peers fail is skipped whole, so its
  `dsh.bundle.patch` layer silently does not apply (#5061). Refusals print to
  stderr naming the row id.
- Exemptions live in **`$DSH_HOME/profiles/<name>/compatibility.json`** — the
  installation being upgraded — shaped
  `{ "<pkg>@<exact-version>": ["<exact-dsh-version>", ...] }`, and granted via
  `dsh plugin --profile <p> allow-version <pkg@version> --dsh-version <ver> --accept-risk`.
  **This is a different file from our per-plugin `compatibility.json`**, which is
  our own declaration and confers no exemption. Worth stating in
  `docs/PLUGIN_GUIDELINES.md` so nobody reaches for the wrong one.
- Consequence for our range choice: `>=0.1.5-rc.2 <0.2.0` already *admits*
  `0.1.7-rc.1` under `includePrerelease`, so nothing is denied today. But an
  exact pin anywhere would be.

**[verified] `rc.2` re-check: none of this moved.** `profile-compatibility.ts`,
`plugin-compatibility.ts` and `apps/cli/src/plugin.ts` have a zero-line diff
across `rc.1..rc.2`, so the exemption file keeps the shape
`{ "<pkg>@<exact-version>": ["<exact-dsh-version>", …] }`
(`packages/boot/app-boot/src/profile-compatibility.ts:10,45`) with canonical
exact-semver validation at `:24-40`, and `dsh plugin --profile <p> allow-version
<pkg@version> --dsh-version <ver> --accept-risk` still exists with those flags.
The `plugin_manager` remote faces `list_version_exemptions` / `set_version_exemption`
are unchanged. §2 therefore needs no rework for `rc.2`.

Two adjacent `rc.2` changes worth knowing, neither of them ours to fix:

- **[source]** `Profile` gained a **required** `skippedBundles: SkippedBundle[]`
  (`{ packageName, reason }`, `packages/boot/app-boot/src/profile.ts:102,106`),
  profile loading no longer prints by itself, and a new export
  `reportSkippedBundles(binName, profile)` (`:118`) is called once per start
  (`apps/cli/src/profile-boot.ts:170`, `apps/desktop-host/src/index.ts:24`). The
  *criteria* for skipping a bundle are unchanged, so §2's "a bundle whose peers
  fail is skipped whole" still describes the behaviour; only the reporting moved.
  The internal `skippedProfileBundles()` was deleted but was never re-exported.
- **[source]** breaking export-shape change: `generateConfigSchema` lost its
  first `binName` parameter (`packages/boot/config-schema/src/index.ts:21`), and
  `OPTIONAL_BUNDLES` gained `…-experimental-auto-review` (`:213`). Zero call
  sites in this repository, so no work. **[verified]** repo-wide grep for
  `generateConfigSchema` and `skippedBundles` returns nothing.

## 3. Measured breakage from the trial bump

> Superseded for planning by §9, which measures the same thing at `0.1.7-rc.2`
> against a cache-busted baseline control. Kept because the per-package shape and
> the methodology note below are still the ones the `rc.2` numbers compare to.

With only the catalogs moved (no source changes): **18 packages, 288 type
errors**. Note that `nx run-many -t typecheck` under-breports — `typecheck`
`dependsOn: ^build`, so a failing dependency hides its dependents; `pnpm -r
--no-bail typecheck` gives the honest number.

Per package:

| Package | errors | Dominant cause |
| --- | --- | --- |
| `dsh-qa-integrations` | **[#514 landed]** decision + code — `SettingsScope`→`ConfigForm` swaps (77 errors, 66 of them the `@yadsh/dsh-qa-surface` cascade) and the card, on **D1 option 2**: the shell, `AGENTS.md` and the shared gate are untouched, the card moved off the deleted slot instead. Host: `installSettings`/`SettingsInstallFace` deleted, `ConfigSchema` marks every card-editable node `.volatile()` (`dataPath` among them — the card writes it and the restart caveat stays), the service takes one `snapshotConfig` per operation, re-applies on `loader/volatile-update` and declines the generated page with `settings.configure({ auto: false }, fiber)`; write-time `validate` has no rc.2 counterpart, so a value the resolvers refuse now persists and the service keeps its state plus a `config.rejected` log. Client: the operator card is a `settings.plugins.tab` page (`qa-integrations-config`, order 30) whose `ConfigForm` comes from `configForms.get` behind `whileServed`, wrapped in the plugin-owned `<ul>` the shell contract already requires. | `src/index.ts` `installSettings` was at `:403-431`, the face at `:1522-1525` (map said `:409,1523`); `src/config.ts` schema + `LiveQaIntegrationsConfig`/`snapshotConfig`/`QaIntegrationsSnapshot` — **the map missed this file**, it is where the volatility lives; `src/client/index.tsx` `:3,40-55,93-114` (was `:3,44-53,75,93-98`); `src/client/operator-card.tsx` `:16,56-64,80-110` plus the new `OperatorCardTab` (was `:5,16,57,60,64,141`); `scripts/verify-package.mjs:206-207` — **not `:215-216`** — now asserts `doesNotMatch` on `settings.plugin.item`. `src/client/card.tsx` (map `:5,46`) and `compatibility.json` needed no edit: its 4 errors and its metadata line were cascade and #511. | 120 | `tests/client-registration.test.ts`, `tests/client-bundle.test.tsx`, `tests/operator-card.test.tsx` (prop `scope`→`form`), `tests/plugin.test.ts` (install stub → `configure` capture + `commit()`), `tests/card.test.tsx` unchanged. Measured on this card: `pnpm -r --no-bail typecheck` reports **0** errors for the package once `@yadsh/dsh-qa-surface` ships `lib/types`, 6 `TS2307` while #513 has not landed; `nx build` and `verify:package` green; `vitest run` 110 files / 810 tests green, and the 2 red files (`plugin`, `credential-help`) are **not** this migration — the rc.2 lockfile's vite 8 SSR transform leaves `@Remote`'s standard decorators in `src/index.ts` for Node to reject, reproducible on untouched `HEAD` of this card and in `dsh-domain-experts` |
| `dsh-qa-surface` | **decision + code, biggest** | volatile `Config`; card path; `SettingsScopeBinder` gone; **4 new `rc.2` reads**; provenance→producer; `dsh-agent-presets` rename; own `qaSurfacePanels` merge | `src/index.ts:487,561`; `src/client/index.tsx:11,528,834-859`; `src/client/QaConfigController.ts:1,35`; `src/client/settings/card.tsx:13,69,73,77,242`; `src/client/QaTranscriptAdapter.ts:476,248`; `src/client/turn-sources.ts:82`; `src/client/QaSessionController.ts:1644`; `src/client/project-session-state.ts:75`; `src/client/panels/contract.ts:70`; `src/access/{capability-catalog.ts:33,207,218,model.ts:533}`; `src/qa-tools/lifecycle.ts:40` already `agent/created` ✔; deprecated reads `prompt-notes.ts:375`, `secure-session.ts:547`, `admin/session-log.ts:130,231`, `provenance/host-store.ts:83,236`, `qa-tools/durable-marker.ts:97,101`; `compatibility.json:4-5,12`; `scripts/verify-package.mjs:501-517`; `package.json:61-70`; `QaChangelog.tsx` (§6) | 130 | ≈14 files: `tests/wiring/index-wiring.test.ts:81-82`, `tests/config/config-controller.test.ts`, `tests/provenance/*`, `tests/transcript/*`, `tests/qa-tools/*`, `tests/admin/*` |
| `dsh-jev-compaction` | 27 | card, `installSection`, LLM message shapes |
| `dsh-qa-browser` | 24 | card surface, client slots |
| `dsh-openviking-memory` | ✔ **done in #516** (D1 took option 2) | volatile Config replaced the settings-section registration; the card moved to `settings.plugins.tab` with our shell; `agent/session-start` → `agent/created` under a non-throwing listener; the plugin declares its own producer kind; the `tool-addition`/`tool-removal` taxonomy is pinned at runtime | landed: `src/config.ts:302` every knob `.volatile()` (`z<Config, LiveConfig>`), `:266` `LiveConfig`, `:279` `snapshotConfig`; `src/index.ts:208` the `agent/created` listener, `:337` `refreshConfig()`, `:402` its call from `activeScoping()`; `src/settings.ts` **deleted** (82 lines; `installSection` is gone from the Host); `src/capture.ts:45` the `openviking-memory` source-kind augmentation, `:61` the captured-kind whitelist (`user`/`model`/`tool`), which is also the default branch §5 demands of a non-exhaustive `switch (source.kind)`; `src/runtime.ts:793` the own kind on injected messages, `:828` `isStartupProfile` matching **both** kinds for one release; `src/client/index.tsx:49` `inject = ["slots", "configForms"]`, `:90` `ctx.configForms.get(ns)`, `:97-103` the tab registration; `src/client/card.tsx:46` `PropsRuntime<"settings.plugins.tab">` over `ConfigForm<Config>`, `:155` the `<li>` inside a plugin-owned `<ul>`; `compatibility.json:9,16`; `scripts/verify-package.mjs:64,76-88`. Checked and kept: `package.json:49-52` — the `dsh.client.inject` list already names every client module the bundle reads, no edit; `src/openviking/capture-utils.ts:151,327,350,457` — **no edit**: a generated fork file whose loose extractor already drops both blocks (`normalizeType("tool-addition")` matches no set, `blockToText` returns `""`, `.filter(Boolean)` discards it), so the rule is pinned by `tests/block-taxonomy.test.ts` rather than by editing the vendored code; `src/capture.ts:93,143` became the whitelist and the own-kind filter; `scripts/smoke-packed-dsh.mjs` **does not exist in this package** — the stale `"0.1.1-rc.2"` default of §6 is `dsh-sleev`'s | ~230 | `tests/settings-live.test.ts` (replaces `settings-install.test.ts`: the schema-volatile namespace pin, and a committed change reaching a session that is already open), `tests/block-taxonomy.test.ts`, `tests/config.test.ts:44-53` (`requireValue` snapshots the live refs), `tests/helpers/harness.ts:82,115` (`createLiveConfig`, `writeConfig`), `tests/runtime-context.test.ts:192,200,277` (both profile attributions), `tests/client-card.test.tsx`, `tests/client-index.test.ts:193-241`, plus the 15 renamed `agent/created` emit sites. Measured on this tree: 31 files / 283 tests pass |
| `dsh-model-safety-gate` | ✔ **done in #517** (D1 option 2) | volatile Config; card; own `"tool-result"` **label** channel is ours, kept verbatim | landed: `src/config.ts` — twelve top-level nodes `.volatile()` (**nothing volatile may sit under a volatile node**, so each group is one live field), `SAFETY_GATE_LIVE_NODES` + `snapshotSafetyGateConfig`, schema cast retargeted to the live view — the row named no config file, and the migration is mostly there; `src/service.ts` — `installSection`/`SettingsInstallFace`/`configSource` deleted, one `loader/volatile-update` listener re-snapshots per reload (the old `structuredClone(config)` would have cloned the references, not the values); `src/shared/settings.ts` — the namespace is the profile entry id now, `model-safety-gate` is gone, and `scripts/verify-package.mjs` pins the pair against `cordis.patch.yml`; `src/client/index.tsx` — `settingsScope` → `configForms`, registered on `settings.plugins.tab` with `{id, order, label}` (the kit's `registerSettingsCard` still defaults to the deleted keyed seat and passes `key`, not `id`/`label`, so a tab cannot route through it yet); `src/client/card.tsx` — `ConfigForm`, `mutate(ops, revision)`, `<li>` inside a plugin-owned `<ul>`; `src/types.ts` — `configRejected` on the Remote, because the Host enforces only the schema and a `validate` hook no longer exists | 55 estimated, **≈340 landed** | `tests/integration/settings.test.ts` rewritten (the `MemorySettings` fake cannot survive — §11's promote-to-`test-kit` item now has one fewer copy), `tests/integration/service.test.ts` (live-commit tests replace the install-face ones), `tests/client-card.test.tsx`, `tests/client-index.test.ts`, `tests/unit/config.test.ts` |
| `dsh-plugin-log-ui` | decision + code | ✔ **done in #521** under D1 option 2 (shell kept, card moved to `settings.plugins.tab`). volatile Config; card; typert-driven panel. **No `MemorySettings` fake left to share**: with `installSection` gone the plugin touches no settings service at all, so this package contributes nothing to `dsh-test-kit`. **`scripts/verify-client-bundle.mjs` does not exist here** — the gate is `scripts/verify-package.mjs:43` (the slot literal), `:47-48` (`dsh-plugin-card__name`, chevron path), `:50-56` (`notMatches`, `cardContract.legacyPatterns`) | landed: `src/config.ts:33-52` all three fields `.volatile()`; `src/types.ts:1-25` `VolatilePluginLogUiConfig`; `src/index.ts:26-33` `PLUGIN_LOG_ENTRY_ID`, `:50-95` `installSection` + `configSource` gone, `getConfig()` reads each `.get()` at call time; `src/client/index.tsx:4,44-47,67-71,115-155,268-287,309,345-360`; `src/client/panel/definition.tsx:63-66` guide `id` (`SidebarRightGuideEntry` gained a required `id`, un-itemised in §8.2); `src/client/styles.ts:4-5` the `<ul>` the shell's `<li>` needs on a tab seat; `compatibility.json:7`; `scripts/verify-package.mjs:43-44` | 60 | `tests/client-panel.test.ts:229-243`, `tests/client-settings-store.test.ts`, `tests/integration.test.ts` — 7 files / 41 tests, but see §13.1: the integration file cannot load under the repo's current `vite` |
| `dsh-draft-sessions` | 13 | client conversation/controller types |
| `dsh-sleev` | ✔ **done in #520** | volatile Config; card on `settings.plugins.tab` under our own shell (D1 option 2, so `registerSettingsSlot` is dropped and the slot call is direct); the smoke-script bug folded in | landed: `src/shared/config.ts:7,33,50` (`Config` fields are `Volatile<T>`, `.volatile()` on every editable node, one `snapshotConfig` per operation) and `:75` (`resolveConfig` stays pure over a raw `ConfigSnapshot`, so `tests/config.test.ts` needed no edit); `src/shared/settings.ts:6,9` (the namespace is the profile entry id `dsh-sleev`, the tab id stays `sleev`); `src/index.ts:47,72,103` (`installSection` gone, `configure({ auto: false })`, and the logger level re-applied by the read that first sees a new value — `loader/volatile-update` is not nameable here: its `Events` merge lives in `@deepseek-ai/cordis-plugin-loader`, which we do not depend on); `src/client/index.tsx:12,146,326,334,356,359` (the kit supplies the shell only; the form comes from `ctx.configForms`; the `<li>` sits in a plugin-owned `<ul>`); `src/client/settings-controller.ts:5,95` (`ConfigForm<SleevSettings>`, `set`/`unset` answer `boolean`); `compatibility.json:7`; `scripts/verify-package.mjs:39,40`; `scripts/smoke-packed-dsh.mjs:20-29`; `scripts/smoke-neuraldeep.ts:38,55,226-231` (user source kind, assistant source without a restated `kind`, `tool`-role result message); `tests/settings-controller.test.ts:1-5,35-59` (`FakeScope implements SettingsScope` → `FakeForm implements ConfigForm`) | 45 estimated, 184+/118− | `tests/settings-controller.test.ts`, `tests/config.test.ts`, and `tests/llm-integration.test.ts`, which loads the volatile schema for real |
| `dsh-prompt-firewall` | ✔ **done in #522** (D1 = option 2: our shell stays ours, the card moves to `settings.plugins.tab`) | volatile Config; card; settings fake rewritten in place | landed: `src/config.ts:49-80` every editable field `.volatile()` (`audit`/`metrics` as whole containers, which is what the card writes), new `readVolatileConfig` `src/config.ts:88`; `src/types.ts:26-64` `PromptFirewallVolatileConfig` beside the flat view, list fields `readonly … \| undefined` — the `\| undefined` is forced, not stylistic, because the typert generator compiles the package with `exactOptionalPropertyTypes` (`packages/plugin-scripts/generate-typert.mjs:112`); `src/index.ts:52` namespace = the **entry id** `dsh-prompt-firewall` (was the Cordis plugin id), `:54` `Config` = the volatile view, `installSection` (was `:89-104`) deleted, one `snapshot()` per operation `:119`, and `reloadRules()` gone from the class and from `PromptFirewallService`; client `src/client/index.tsx:4,64,69,157,199,206,221`. Checked and kept: `compatibility.json:4-5` (#511), `:7` → `settings.plugins.tab`; `scripts/verify-package.mjs` needed no edit and **the row's `scripts/verify-client-bundle.mjs:34` never existed in this package**; the only shell CSS change is the plugin-owned `<ul>` (`src/client/styles.ts:4`). The settings fake: `tests/settings.test.ts` no longer subclasses `SettingsForms` — its constructor reaches `ctx.root.loader` and its `static inject` is `['configEditor','profileContext']`, neither of which a bare cordis context has — so the test provides a structural stand-in under the `settings` name and asserts the write; the shared promotion §11 wanted (one `MemorySettings` in `@yadsh/dsh-test-kit` for three plugins) is **still owed**, the other two copies are untouched. 40 estimated / ≈120 actual, of which ≈60 is the test file | `tests/settings.test.ts` (8), `tests/client-index.test.ts`, `tests/client-settings-store.test.ts` — 8 files / 36 tests green, but only through a `tsc`-emitted build: see §13.1 |
| `dsh-documents` | 11 (+build) | card + `installSection` |
| `dsh-web-fetch-authenticated` | 9 | card + `installSection` |
| `dsh-ui-repair` | ✔ **done in #523** (D1 option 2) | volatile Config; card; **a DOM selector that is functional, not cosmetic**; the join key this plugin already exemplifies §4.2 | landed: `src/config.ts:15-24` every node `.volatile()` (the ARRAY for `ignore`), `src/shared/config.ts` gains `UIRepairVolatileConfig` + `resolveVolatileConfig` and owns `UI_REPAIR_SETTINGS_NAMESPACE`, `src/index.ts` installSection block deleted and `Config = ReturnType<typeof ConfigSchema>`, `src/client/index.ts` `inject = ["slots", "configForms"]` + `ctx.configForms.get(ns)` + a `settings.plugins.tab` seat, `src/client/card.tsx` `ConfigForm` face and `form.set`, **`src/client/dom.ts:11`** `[data-slot='settings.plugin.item'] > *` → `li.dsh-plugin-card`, `scripts/verify-client-bundle.mjs:39-42`. **Checked and kept: `package.json:39-41`** — under option 2 the client still reads faces from `dsh-client-ui-settings` (`configForms`) and `dsh-client-ui-settings-plugins` (the section rendering the tab), so the `@yadsh/dsh-ui-repair#dsh-ui-repair` join key of §4.2 is not reached: the namespace is the bare `cordis.patch.yml:4` row id `dsh-ui-repair`. `settings.configure({ auto: false })` (§4.1) was **not** added, so the Host may still render its own page for the namespace next to this tab — one live stand decides whether that duplication needs the lever | 40 | `tests/config.test.ts`, `tests/client-index.test.ts`, `tests/dom.test.ts`, `tests/client-bundle.test.ts`, `tests/build-wiring.test.ts` |
| `dsh-user-correction-miner` | code | ✔ **done in #528** (10 insertions, 18 deletions across three files — not the 25 estimated). `tool-result` block gone; `SessionHeader` fixture; `SESSION_QUERY_CORRUPT_SESSION` needed no code — the historical scan's per-session `catch` already counts it as one failed session | landed: `src/mining/message-text.ts:5` **[verified]** (dead branch dropped, so `blockText` stops recursing); `tests/fixtures/sessions.ts:9-10` (header from `SESSION_FORMAT_VERSION` + `SessionId`, cast gone), `:20,30` (`plugin` source kind is absent from both axes → `system-prompt`; the fixture's own label became `injected`, which also moved `tests/context-extractor.test.ts:73` — a site this map missed), `:77-81` (`tool`-role result message, `toolCallId` beside it). Checked and kept: `src/mining/context-extractor.ts:39,92`, `src/types.ts:34`, `src/dsh/storage.ts:44` (the map named it `src/storage.ts`, which never existed — own `tool-result` **label**, not the block), `src/mining/engine.ts:127` (`snapshotEvents()` alive); `compatibility.json` → #511 | 25 | `tests/{context-extractor,engine,storage,sessions}.test.ts` — 65 pass |
| `dsh-domain-experts` | ✔ **done in #529** (no card decision — D1 never gated it) | 2, both `installSection` | volatile entry `Config`; the browser half is a management page, not a configuration card, so it survived untouched | landed: `src/config.ts:111` `ConfigSchema: z<Config, LiveConfig>` with all ten leaves `.volatile()`, `:60` `LiveConfig`, `:74` `snapshotConfig` (+ `:89` the structural reference probe), `:6` **`SETTINGS_NAMESPACE` deleted** — the namespace of a profile is its entry id `dsh-domain-experts` now and this plugin never writes config back, so the constant named a section that no longer exists; `src/index.ts:2-4` the loader type anchor in place of the `dsh-settings` import, `:122` one `entry` field where `entry` and `source` were (the map's `:152-153`), `:205-208` one `loader/volatile-update` effect where the `installSection` block stood (the map's `:231`, verified on the pre-#598 entry), `:229-230` `config()` takes one snapshot per operation, `:522-532` the surface re-exports — **every `src/index.ts` ref here is the #598 layout**: the card was cut once against the 1019-line entry, then #598 split that file (catalog to `src/catalog.ts`, verdicts to `src/validate.ts`), which moved the settings registration nowhere — it stayed in the entry — but renumbered it by ~390 lines and conflicted the first patch; `compatibility.json:13`; `package.json` `@deepseek-ai/cordis-plugin-loader` peer + dev (`catalog:dsh` / `catalog:dsh-dev`, already in both catalogs — the pattern `dsh-documents` set). Checked and kept: `src/client/index.tsx:47` registers `settings.plugins.tab`, which survives, and `scripts/verify-package.mjs:74` still requires **no** card shell in the bundle; `settings.configure({ auto: false })` deliberately **not** called — the ten volatile fields are the successor of the old section and nothing in `src/client` reads `ctx.configForms` (grep: zero hits), so the generated page is their only editor; `dsh-sleev` and `dsh-documents` take the lever because their own card draws the form. `defaultMemoryProvider`, `memoryDbPath` and `auditLimit` stay built-once facts, as their descriptions already promised | 20 estimated, ~45 landed | `tests/config.test.ts` +4 (every leaf answers `get()`; a snapshot of the schema resolves to the documented defaults; a committed value is followed without a remount; a knob that resolves to nothing is dropped), `tests/wiring.test.ts` +2 (the `enabled` flip through `loader/volatile-update`, and an unrelated knob leaving the tool surface alone) — 34 files / 332 tests green; `wiring.test.ts` still cannot load under §13.3 (reproduced on untouched `HEAD` in this package: `SyntaxError: Invalid or unexpected token` at import), so its 23 assertions were run against the compiled `lib/` entry instead, the way #514 did |
| `dsh-preset-persona-editor` | ✔ **done in #518** (decision D2, option 1) | `AgentPresetRegistry` lost `authorable`/`copy` — the `TS2739` at `src/host/service.ts:114` is gone because the write half that hit it is gone; §11's row carries the landed shape |
| `dsh-doc-impact` | ✔ **done in #530** (347 insertions, 277 deletions over `src` + `scripts`; the 35 the row promised was the card half alone — the host half it did not name is the volume) | volatile entry `Config`; card is a Plugins tab under our own shell (D1 option 2); own message source kind | landed: `src/dsh/plugin-config.ts:71` `ConfigSchema` (every card node `.volatile()`, nested groups marked at the container) with `plainEntryConfig` `:310` and `readLiveConfig` `:364` replacing `declaredSettingsBase`/`fromSettingsSection`; **`src/dsh/settings.ts` deleted** (133 lines of `settings.register`/`settings.get` that rc.2 answers to nothing — it typed itself through a self-declared `SettingsService`, which is why it cost zero compile errors); `src/dsh/plugin.ts:26` `export const Config`, `:107` `settings.configure({ auto: false })` (§4.1 taken, not deferred — this plugin owns its page); `src/client/index.ts:33,55` tab seat `settings.plugins.tab` keyed by the namespace, form through `ctx.configForms.get`; `src/client/settings-form.ts` writes `mutate([{op,path,value}], revision)` against the **nested** document (`defaults.mode`, `safety.*`, `changeDetection.maxSnapshotFiles`); `src/client/card.ts:264` `<ul>` around the shell (AGENTS.md `settings.plugins.tab`), shell and badge unchanged; `src/dsh/lifecycle.ts:13,94` kind `doc-impact` via a `MessageSourceMap` augmentation; `scripts/verify-client-bundle.mjs:43-55`. **The namespace moved `doc-impact` → `dsh-doc-impact`** — it is the profile entry id now (§4.2), so values saved through the old card do not carry over while the profile patch line does. Checked and kept: `src/dsh/{commands.ts:14,67,tools.ts:47,lifecycle.ts:39}` `snapshotEvents` folds (§5/#531: no replacement for a whole-log fold); `compatibility.json:4-5` → #511 | 35 → **≈350** | `tests/client-bundle.test.ts` 8 (nested fake `ConfigForm`, seat↔namespace pair), `tests/settings.test.ts` 10 (schema↔card path pairing pinned: every card field is under exactly one volatile node), `tests/e2e.test.ts` 4 — 87 pass |
| `dsh-answer-review-gate` | 1 | message role `'plugin'` removed |

Error-class frequency (top): `'settings' is of type 'unknown'` ×57, `ProviderCardProps`
token prop ×55 (cascade), `no exported member 'SettingsScope'` ×16,
`Property 'settingsScope' does not exist` ×9, `installSection does not exist on
type 'SettingsForms'` ×8, `'settings.plugin.item' does not satisfy …` ×9.

The whole `packages/*` tier (plugin-kit, plugin-log, test-kit, audit-*) compiles
unchanged — the blast radius is confined to plugin sources.

## 4. The settings subsystem was rewritten — this is the migration

**[verified]** `@deepseek-ai/dsh-settings` no longer exports `SettingsProvider`;
`ctx.settings` is the `SettingsForms` service and has **no `installSection`**.
`@deepseek-ai/dsh-client-ui-settings/client` no longer exports `SettingsScope`,
`SettingsScopeBinder` or `SettingsScopeSnapshot`; `ctx.settingsScope` does not
exist. The slot **`settings.plugin.item` is deleted** — the compiler says so
directly:

```
Type '"settings.plugin.item"' does not satisfy the constraint
'"root" | "settings.action" | "settings.close" | "settings.general.item" |
 "settings.header" | "settings.launcher" | "settings.onboarding" |
 "settings.plugins.tab" | "settings.section" | "settings.trigger"'.
```

`settings.section` and `settings.plugins.tab` **survive**; only
`settings.plugin.item` is gone. There is no compatibility shim.

The model change: on 0.1.5 a plugin carried a profile `Config` *and* separately
registered a live browser-editable settings namespace via `installSection`. On
0.1.7 those unify — a field is a form field iff its schema node carries
`.volatile()`, and **the settings namespace is the Cordis profile entry id**.
`applies` collapses to the literal `'live'`; `SettingsRegisterOptions.validate`
goes away (schema `.min/.max/.pattern` on the complete Config is enforced by the
Host before persistence); the `settings/updated` event is replaced by
`loader/volatile-update`.

### 4.1 Host recipe

```ts
import { Context, type Volatile } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";   // ctx.settings merge only
import z from "@deepseek-ai/schemastery";

export interface Config {
  enabled: Volatile<boolean>;
  mode: Volatile<"observe" | "suggest" | "auto">;
  ignore: Volatile<IgnoreRule[]>;
}
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  mode: z.union(["observe", "suggest", "auto"]).default("observe").volatile(),
  ignore: z.array(ignoreRuleSchema).default([]).volatile(),   // mark the ARRAY, not items
});
```

Rules that will bite **[source]**:

- A volatile node must sit at a **fixed object path with no enclosing volatile
  node**. Volatility inside array items, dictionary values, tuple members or
  union members is rejected at resolve time — wrap the whole container instead.
- `Config` fields become `Volatile<T>`; read `config.mode.get()` **at the start of
  each operation** (or take one snapshot per operation). Destructuring once at
  `apply()` time freezes the value.
- To keep the namespace out of the auto-generated page:
  `ctx.inject(["settings"], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))`.
  Note `settings` is now an *optional* service — do not hard-inject it.
- Writing config from the plugin itself: capture `ctx.fiber.entry?.options.id` and
  call `ctx.get("settings").update(entryId, patch)`.

### 4.2 Client recipe — where our cards go

**[source, verified against the render sites]** The successor surface is the
Plugins page, via `@deepseek-ai/dsh-client-ui-plugin-manager` (a new catalog
entry — it is not in our catalogs today). Three slots carry configuration:

- `plugins.item` — *list*, for **official** first-party companions only. Not ours.
- `plugins.bundle.config` — *keyed* by our **package name**. **Trap: the page
  renders this slot with `{ view: 'page' }` and passes no `form`**
  (`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:584`), so a
  registrant must resolve its own `ConfigForm` and therefore must know its entry id.
- `plugins.row.config` — *keyed* by `` `${package name}#${row id}` ``
  (`config-ledger.ts:36`), rendered with `{ view: 'page', form }` (`:500`).
  **This is the one to use.**

[rc.2 fix] **[verified]** `rc.2` left this contract byte-identical —
`slot-contract.ts`, `config-ledger.ts` and all of `packages/client/ui-slots/src`
have an empty diff across `rc.1..rc.2` — but `PluginManagerPage.tsx` shifted
**−5 lines**, so the two citations above are stale at the target:
`plugins.bundle.config` is still rendered `{ view: 'page' }` with **no `form`**,
now at `:579`; `plugins.row.config` is still rendered **with** `form`, now at
`:495`; `plugins.item` summary seats are at `:398`/`:446` and its page+form at
`:450`. Keyed seats take `{ entryKey }`, list seats take `{ only }`.
`formFor(id)` (`:1151-1155`) still calls `props.configForm(id)` with the **row id
as the namespace**, so the join-key insight below survives `rc.2` untouched.

Three refinements the `rc.1` pass missed, all **[verified]** at both tags (so
they were never `rc.2` changes — they were gaps in this document):

- `ConfigForm<T>` (`packages/client/ui-settings/src/client/config-form-types.ts:39-77`)
  has **`set(field, value)`** (`:68`) and **`unset(field)`** (`:76`) beside
  `mutate(ops, expectedRevision?)` (`:58`). A card may therefore keep its
  one-field write as `form.set("enabled", checked)` instead of the op-array form
  in the table below — use `mutate` only for multi-path or ordered patches.
- **But a `plugins.row.config` card does not receive a `ConfigForm`.** The slot
  hands it `ConfigPageForm`, which is **only `{ state, mutate }`**
  (`slot-contract.ts:125-130`, built at `PluginManagerPage.tsx:1154`). So in the
  slot path the op-array call is the *only* legal one, and §4.2's recipe is
  correct as written; `set`/`unset` become reachable only if the card resolves
  the full `ConfigForm` itself through `ctx.configForms.get<T>(ns)` — which is
  the pattern the harness's own locale/settings code uses, and which a
  `plugins.bundle.config` registrant is forced into because that slot passes no
  form at all.
- `formFor` returns **`undefined`** when the namespace is absent from the Host
  `describe()` view (`:1152`) — which is exactly what happens to a plugin whose
  Config has **no `.volatile()` field**. Every card in the slot path must
  null-guard `form` and render a "no live settings" state, or a plugin that
  forgets `.volatile()` shows a blank page instead of an error.

Also **[source]** the client-side invalidation signal is
**`settings/document-updated(ns, revision)`**
(`packages/settings/settings/src/types.ts:66-76`, emitted `index.ts:317,337`) —
§4 only mentioned `loader/volatile-update`, which is the *plugin-side* signal.
A card that reads `ctx.configForms` directly, rather than taking the `form` the
page hands it, subscribes through the former.

The key insight that makes this cheap for us: the page computes `form` from
`formFor(openRow.rowId)`, i.e. **the settings namespace is the profile row id**,
and our bundles already declare a row whose id *is* our old namespace. For
`dsh-ui-repair`, `cordis.patch.yml` is

```yaml
- insert:
    - id: dsh-ui-repair
      name: "@yadsh/dsh-ui-repair"
```

so the namespace `dsh-ui-repair` is unchanged, and the join key becomes
`@yadsh/dsh-ui-repair#dsh-ui-repair`. The old contract ("the namespace is the
join key") survives through the row id — we do not have to invent anything.

```tsx
export const inject = ["slots", "locale", "configForms"];   // was ["slots", "settingsScope"]

ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
  name: "plugins.row.config",
  key: "@yadsh/dsh-ui-repair#dsh-ui-repair",
  locale: "dsh-ui-repair",
}, UIRepairCard));
```

`ConfigFormSnapshot<T>` is `{ status: 'loading'|'ready'|'unavailable', value, base,
user, revision, writable, mode: 'host'|'memory' }` — same three layers
`SettingsScope` exposed, and `status`/`writable`/`value` reads are **unchanged**,
so existing card bodies need only the write call swapped:

```ts
// 0.1.5                                    // 0.1.7
scope.set("enabled", checked)          →    form.mutate([{ op: "set", path: ["enabled"], value: checked }], form.state.revision)
scope.getSnapshot().value             →    form.state.value
scope.subscribe(listener)             →    (not needed — the page owns the subscription and re-renders)
```

`packages/plugin-kit/src/client/settings-store.ts#bindSettingsExternalStore`
survives untouched: it is structural over `subscribe`/`getSnapshot`, which
`ConfigForm` still provides.

### 4.3 The card-shell contract, decided for option 1

**[decided 2026-10-01, option 1]** The maintainer chose to follow the Host chrome:
`CardShell` is dropped from the `plugins.row.config` path, `AGENTS.md` and
`packages/plugin-scripts/verify-plugin-card-contract.mjs` were rewritten to match, and
the gate now reads the seat off the built bundle rather than trusting the plugin's
declaration. The remaining open question in this section is therefore closed; what
survives is the choice itself, kept here because the second half of the series (twelve
card components) is carried out against it. §4.3a item 3 — the focus ring — is resolved
the same way: cards inside the panel chrome take `--dsw-focus-ring-width` /
`--dsw-focus-ring-color` (with a fallback length on the width, or the shorthand is
dropped where the token is undefined) and never a hard-coded outline, which is what the
new gate asserts.

What follows is the question **as it stood before the call**, kept verbatim because the
series is being executed against the reasoning. The framing "needs a maintainer call"
and the description of `settings.plugins.tab` as the point `AGENTS.md` prescribes are
both superseded by the decision above: the tab remains a placement the repository is
moving away from, and its cards keep the shell only because nothing around them draws
a frame.

**This was the one thing that needed a maintainer call, not an edit.** Our cards
draw their own `dsh-plugin-card` shell (`CardShell`, the `<li>` root, the 14×14
chevron) because on 0.1.5 the host gave each card a bare keyed slot seat. On
0.1.7 the Plugins page **draws the chrome itself** — `<li className={css.card}>`
plus a `CardHead` with artwork, title and description
(`PluginManagerPage.tsx:397-406, 430-459`), and the slot doc states "The page
draws the title, icon, and crumb itself". Our `AGENTS.md` shell rules and the
per-plugin `verify-package` gates that assert `dsh-plugin-card` and the chevron
path then describe a surface the host already provides.

Options:

1. **Accept the host chrome** — delete `CardShell` from the `plugins.row.config`
   path, keep it only for `settings.section`/`settings.plugins.tab` pages, and
   rewrite the AGENTS.md card rules and the shell assertions accordingly. Most
   idiomatic; touches the shared gate in
   `packages/plugin-scripts/verify-plugin-card-contract.mjs`.
2. **Keep our shell** and register on `settings.plugins.tab` instead (that slot
   survives, and was at the time what `AGENTS.md` prescribed for feature-owned
   pages). Smallest diff and preserves every gate verbatim; costs us the
   first-party Plugins-page integration and puts plugin config under Settings.
   **Not chosen** — see the decision above; `AGENTS.md` now treats the tab as a
   placement the repository is leaving, not the target for a new card.

Option 2 is strictly less work and fully legal on 0.1.7; option 1 is where the
platform is going. Choose before starting, because it decides whether ~12 card
components lose their outer shell.

**[unverified]** Whether `plugins.row.config` requires any Host-side counterpart
registration for a third-party bundle. The harness's own out-of-repo example
(`apps/web/tests/fixtures/plugins/fixture-live-client/client.js`) registers it
purely from the client half and expects it at
`<pkg>#<rowId>`; nothing pairs it host-side. Needs one real stand to confirm.

### 4.3a `rc.2` addendum to the card-shell decision

Three facts this pass settled, and they change the shape of the choice above.

**1. **[verified]** the Host-counterpart question is closed, and the answer is
"no host-side registration needed".
`apps/web/tests/fixtures/plugins/fixture-live-client/`
is unchanged across `rc.1..rc.2`: its host half is literally
`export function apply() {}`, its `cordis.patch.yml` declares one row
`id: fixture-live-client` / `name: '@fixture/live-client'`, and `client.js`
injects only `['slots','locale']` — no `configForms` — while registering
`plugins.row.config` at `key: '@fixture/live-client#fixture-live-client'`. The
only Host-side requirement is that the (package, rowId) pair really exists in the
inventory, because the configure control is gated on
`ledger.rows.has(rowConfigKey(…))` (`PluginManagerPage.tsx:1191`).
**[unverified]** remains one narrower thing: that fixture's card ignores `form`
entirely (hardcoded `defaultValue`, no read or write), so nothing in the harness
proves the *wired* read/write path end to end. One live stand still settles that.

**2. [verified] the host chrome moved off our `AGENTS.md` shell contract between
`rc.1` and `rc.2`.** The structure is the same (`CardHead` at
`PluginManagerPage.tsx:301`, `<li className={`${css.card} ${css.cardLink}`}>` at
`:362`/`:397`) but every token in it was re-based onto the design system
(`packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css`):

| our `AGENTS.md` shell | the host card at `rc.1` | the host card at `rc.2` |
| --- | --- | --- |
| card radius | `12px` | `var(--dsw-radius-xl)` = **20px** |
| focus ring | `2px solid brand-primary`, `outline-offset:-2px` | `var(--dsw-focus-ring-width) solid var(--dsw-alias-state-business-primary)` |
| first-party sibling radius / stroke | — | `var(--dsw-radius-lg)`; settings cards now `0.5px solid var(--dsw-alias-settings-card-stroke)` = `border-l4` |
| top strip | — | `<div data-window-drag>` (`:335`) with the page inset reallocated |

Consequence for the decision: option 1 now yields **20px** corners, and option 2
keeps our **12px** card, which is to say the two are now *visibly* different
radii — the choice is no longer only about duplication, it is about which
rounded rectangle a user sees next to first-party cards. The `AGENTS.md` canonical
shell CSS ("Keep the shell rules identical in every self-contained client
bundle") is **no longer a copy of the host's shell**, so under option 2 that
sentence becomes a deliberate divergence claim and needs the maintainer's name on
it either way. The design tokens themselves are safe: **[verified]**
`--dsw-alias-*` went 90 → 93 names with **zero removals or renames**, and every
alias `AGENTS.md` cites still exists
(`packages/client/ui-theme/src/styles/design-platform.css:171,172,178,186,191,214,219,220,221`
light / `:281,282,288,296,301,324,329,330,331` dark).

**3. [source, needs one browser check] `rc.2` added a stylesheet that can outrank
our card's focus ring.** `packages/client/ui-theme/src/styles/focus.css` (mounted
via `src/client/styles.ts:17`) contains
`html[data-input-modality='pointer'] body :focus-visible:not(:read-write){outline-color:transparent}`,
specificity **0-3-2**, against our
`.dsh-plugin-card__header:focus-visible{outline:2px solid …}` at **0-2-0**. After
a mouse click, our card's ring can paint transparent while the host's own cards,
which adopted the new `--dsw-focus-ring-*` variables, do not. Keyboard-only focus
is unaffected. This is the one §4.3 item with an accessibility angle, so it
belongs in the same maintainer call: either the shell adopts the host focus
tokens, or `AGENTS.md` must specify a higher-specificity ring rule of its own.

## 5. Non-settings breakages

All **[verified]** by the compiler during the trial bump:

- **Message roles.** `'plugin'` is no longer a message role
  (`'user' | 'model' | 'tool' | 'system-prompt'`). Hits
  `dsh-answer-review-gate/src/index.ts:128` and role-tagged fixtures in
  `dsh-qa-*`.

  [rc.2 fix] **[verified]** the rule holds but the wording is wrong on two
  counts, and the next reader should not carry it forward as written.
  `'user' | 'model' | 'tool' | 'system-prompt'` is **not** the role union — it is
  `MessageSourceMap`, the *producer source kinds*
  (`packages/llm/llm/src/message.ts:110-115`, `MessageSource` at `:136`). The
  actual roles are `'system' | 'developer' | 'user' | 'assistant' | 'tool'`
  (`message.ts:152-180`). `plugin` is absent from **both** axes, which is why the
  compiler still rejects it. More important: **source kinds are merge-extensible
  and `rc.2` adds a fifth, `'tool-registry'`**, declared by `@deepseek-ai/dsh-tools`
  through `declare module '@deepseek-ai/dsh-llm'`
  (`packages/core/tools/src/index.ts:31-36`). Any `switch (source.kind)` in our
  plugins therefore cannot be exhaustive and must carry a default branch — the
  `rc.1` framing invited exactly the wrong fix.

- **`PostToolDecision`** literal shape changed
  (`dsh-jev-compaction/tests/integration/post-execute.test.ts:241`); additively
  gained `{ kind: 'cancel' }` and `deny.info?`.

  [rc.2 fix] **[verified]** this sentence names the wrong type. `PostToolDecision`
  is **textually identical** at `rc.1` and `rc.2` and has only `accept`/`block`
  members (`packages/core/tools/src/index.ts:617-620`) — no `cancel`, no `deny`.
  `{ kind: 'cancel' }` and `deny.info?` belong to **`PreToolDecision`** (`:607-611`).
  New at `rc.2`, and additive: `PreToolDecision.ask` gained
  `displayReason?: { readonly en: string; readonly [locale: string]: string }`
  (`:611`), forwarded into the approval ask (`:1749`). **[inferred]** the
  `post-execute.test.ts:241` failure is therefore the
  `additionalContexts: UserMessage[]` element shape, not the decision literal;
  settle with `pnpm --filter @yadsh/dsh-jev-compaction typecheck` after the bump.

- **Preset registry face.** `AgentPresetRegistry` no longer has `authorable` and
  `copy`, which `dsh-preset-persona-editor/src/host/preset-reader.ts`'s
  `PresetRosterFace` expects (`src/host/service.ts:114`). The roster was split
  across `dsh-agent-preset` / `dsh-agent-preset-registry`; the copy-to-writable-root
  capability needs a new call site — **[unverified]** where it went.

  [rc.2 fix] **[verified]** settled, and the answer is worse than a relocation:
  **the capability was deleted, not moved.** `authorable` and `copy` are absent at
  *both* tags (`git grep authorable` over harness `src` returns zero), and
  `writableRoot` / `copyComposition` / `deleteComposition` occur only in sandbox
  packages. The `agent-preset-registry` remote face is exactly `list`, `read`,
  `select` (`packages/preset/agent-preset-registry/src/index.ts:170,193,318`). The
  whole 0.1.5 authoring module (`packages/preset/agent-presets/src/authoring.ts`),
  `AgentPresetRow.trust`, `AgentPresetRoster.authorable` and the
  `agent-preset/read-only` remote error are gone, and `AgentPresetRow` is now just
  `{ id, isDefault, name?, description?, broken? }` (`src/types.ts:7-20`).
  **New at `rc.2` on top of that:** `modeSelectionEnabled` was removed from both
  `Config` and `AgentPresetRoster`, `listSelectable()` is gone, and
  `remoteExportList`'s payload shrank (`src/index.ts:53-74,164-172`,
  `src/types.ts:22`) — **but neither removal reaches
  `dsh-preset-persona-editor`**, which this bullet claimed at `src/index.ts:561`:
  `modeSelectionEnabled` occurs in no plugin or package source at the pre-cutover
  tag (`git grep` over `plugins` and `packages` at `df9f26f3` returns zero), and
  `standingKeyFor` occurs in exactly one place among the plugin and package
  sources (`git grep` over `plugins` and `packages` at `df9f26f3`; the name also
  survives in prose — this document and
  `.nx/version-plans/513-qa-surface-rc2-settings-config.md:29` — which reads the
  finding rather than reproducing it) —
  `dsh-qa-surface/tests/wiring/index-wiring.test.ts:101`, a stub of the
  *registry's* own remote, not a reader of it. This plugin's `src/index.ts` is
  111 lines at `df9f26f3` (this cutover took it to 94), so the cited site never
  existed. D2 was, and stayed, about
  `authorable` and `copy` alone.
  **[inferred]** nothing under `packages/preset` touches the filesystem at `rc.2`,
  so durable authoring has no Host path left: either drop copy/authorable and
  treat presets as read-only plus `select`, or call
  `ctx.agentPresets.register(definition)` in-process, which is memory-only and
  returns a disposer (`src/index.ts:80`). This is now a feature decision for the
  owner, not a migration detail — see §10.

  **[landed #518, 27.09] D2 taken as read-only, and the face moved.** The plugin
  now type-imports `@deepseek-ai/dsh-agent-preset-registry` and reads through
  `list()`, `resolve()`, `defaultId` and `readDocument(id)`; the class in `rc.2`
  is `AgentPresetRegistry` and its `resolve()` answers `AgentPreset`
  (`{ id, name?, description?, order?, broken? }` — `lib/types/preset.d.ts`),
  *not* the `AgentPresetRow` above, which is `remoteExportList()`'s shape.
  `readDocument` is what replaced the file: it dumps the declared child plugin
  list as entry-list YAML (`lib/types/types.d.ts`, `readDocument` in
  `lib/index.js`), so `PresetEntry`'s `trust` and `path`, `PresetRosterFace`'s
  `authorable` and `copy`, the `readPresetFile`/`readSectionsModule` helpers and
  the whole of `src/host/preset-writer.ts` are gone — the last in its own commit,
  but **that commit is not a reversible unit on its own**:
  `git merge-tree --write-tree --merge-base=<write-half> HEAD <write-half>^`,
  taken at `296b8836`, the last code commit of this series, conflicts in 20 paths (17
  content, 3 modify/delete), and the `preset-writer.ts` it puts back reads
  `readPresetFile`/`revisionOf` and `preset.path`, which the read-path migration
  deleted, so the result does not compile. Reversing D2 is a revert of the whole
  #518 series, and that is the cost #605 has to budget.
  `standingKeyFor` and `modeSelectionEnabled` were
  never read by this plugin: `src/index.ts:561` above is a **harness** line, not
  one of ours, and our `src` has zero hits for either name. `select(agent, id)`
  needs a live `Agent`, so the settings page has no use for it and did not gain
  one.
- **`tool-result` blocks are gone.** `ToolResultBlock` was replaced by
  `ToolAdditionBlock`/`ToolRemovalBlock`, so `ContentBlock` no longer has
  `content`, and `ToolResultMessage` no longer overlaps the old literal shapes.
  This is the largest non-settings cluster: `dsh-jev-compaction`
  (`src/dsh/surface.ts:75,82,142`, `src/planner/collect.ts:72` + 4 test files),
  `dsh-user-correction-miner` (`src/mining/message-text.ts:5`),
  `dsh-openviking-memory`. Several are `as`-casts that now need an explicit
  `unknown` hop or a real narrow.

  [rc.2 fix] **[verified]** the type story is unchanged at `rc.2`
  (`ToolAdditionBlock` `packages/llm/llm/src/types.ts:115`, `ToolRemovalBlock`
  `:127`, `ContentBlockMap` `:137` with no `tool-result` key, `ContentBlock` `:150`;
  `ToolResultMessage` `message.ts:173-180` inherits a single-level
  `content: readonly ContentBlock[]` from `MessageBase` `:139-143`), and
  `session/'tool/result'` still carries `{ turn, step, message: ToolResultMessage, … }`
  (`packages/core/session/src/types.ts:375-378`). So `surface.ts:75,82`'s
  `message.content[0].content` becomes `message.content`. **But `rc.2` makes this
  cluster far more serious than a compile error** — see §8.4: the host now
  *emits* those blocks.
- **`SessionHeader`** fixture shape changed
  (`dsh-user-correction-miner/tests/fixtures/sessions.ts:7`).
  **[verified]** unchanged at `rc.2`: `packages/core/session/src/types.ts:94`, and
  `SESSION_FORMAT_VERSION` is `4` at both tags.
- **`dsh-llm` provenance rename**: `AssistantProvenance` →
  `AssistantProviderMetadata`, and client-side `provenance` →
  `producer`/`providerMetadata`. Only `dsh-qa-surface` is affected
  (`src/client/QaTranscriptAdapter.ts`).

Also **[source]**, no compile error but runtime-relevant:

- **`agent/session-start` was deleted**; `agent/created` replaces it with payload
  `{ agent, source, signal? }` and **`@mode serial`** — listeners are awaited and a
  throw **rolls back agent creation**. Zero occurrences remain in the harness at
  rc.1. Our only source user is `dsh-openviking-memory/src/index.ts:188`, plus
  ~7 test emit sites in `injection.test.ts`, `qa-scoping.test.ts`,
  `runtime-context.test.ts`. The handler must become non-throwing.
  **[verified] unchanged at `rc.2`** — `packages/core/agent/src/**` has an empty
  diff across the range: `'agent/created'` at
  `packages/core/agent/src/runtime-types.ts:261` with
  `@mode serial` at `:259` and "a throw or rejection fails creation and skips
  later listeners" at `:251-252`; `SessionStartSource` is
  `'startup' | 'resume' | 'clear' | 'compact'` (`:125`); zero `agent/session-start`
  in any `src`. Note `dsh-qa-surface/src/qa-tools/lifecycle.ts:40` already uses
  `agent/created`, so only `dsh-openviking-memory` and its ≈15 test emit sites move.
- **`Session.eventAt` / `snapshotEvents` / `ownEvents` are deprecated but alive**
  at rc.1 (`packages/core/session/src/index.ts:647`) — no compile errors, which is
  why the trial bump stayed quiet about them. ~14 call sites across
  `dsh-answer-review-gate`, `dsh-doc-impact`, `dsh-jev-compaction`,
  `dsh-openviking-memory`, `dsh-qa-surface`.
  **[verified] still alive at `rc.2`**, at `index.ts:635`, `:649`, `:666` (each
  `@deprecated` note shifted +2 lines, signatures identical). **[verified]** across
  the whole `rc.1..rc.2` range the harness added **zero** `@deprecated` markers and
  hardened **zero** existing ones, so no call site silently became an error and
  there is no new deprecation debt to plan against. The `rc.2` compiler output
  agrees: no error mentions these three.

  **[verified] #531 audit — at `rc.2` the debt is not takeable: these readers have
  no replacement.** Read from the *published* `@deepseek-ai/dsh-session@0.1.7-rc.2`
  rather than the harness checkout: all three carry `@deprecated Existing logic may
  remain unmigrated for now, but new calls are prohibited`
  (`lib/types/index.d.ts:177,187,196`), and the shipped `README.md:62` names the one
  sanctioned substitution — "Callers that only need a length use `seq`"
  (`get seq()` at `:208`, documented as "always the log length"). Everything else
  left on the non-deprecated surface is a fold over a fixed taxonomy
  (`requestHeader` `:259`, `requestContext` `:268`, `toolHistory` `:278`,
  `deriveMessages` `:303`) or the message-oriented `registerMessageProjection`
  `:347`; none of them folds a plugin-owned event type, so a whole-log fold like
  `effectiveSessionScope(session.snapshotEvents())` has nowhere to move. Paying the
  debt means retargeting scope resolution onto incremental projection state, which is
  a design card, not a cutover edit. Only the two length-only sites
  (`dsh-session-scope`'s `scope-fs.ts:121,140` → `session.seq`) are payable today.
- **`Fiber.update()` no longer returns the waterfall promise** (now `void`), and
  the `internal/update` event's `next` is sync-only. Any `await ctx.fiber.update(...)`
  silently resolves to `undefined`. **[verified]** same at `rc.2`
  (`vendor/cordis/src/fiber.ts:736`, `@returns nothing` at `:733`;
  `'internal/update'` at `vendor/cordis/src/events.ts:343`). **[inferred]** the
  cordis vendor tree is untracked in git, so no tag-to-tag cordis diff is
  possible; this is the checkout the `rc.2` build links against
  (`link:../../../vendor/cordis`).
- **`schemastery` `Schema<S, T>` gained a third type parameter** (`Mode`). Our
  `as z<UIRepairPluginConfig>` style casts still work, but any conditional type
  written `X extends Schema<infer S, unknown>` mis-captures.
  **[verified]** `vendor/schemastery` has no diff in the range — `rc.2` changes
  nothing here.
- Client bundle format is unchanged: `window.__ModuleLoader__.load({ id, factory })`
  with `id === package.json.name`, and `/plugins/<full-package-name>/client.js`
  both still hold — so the AGENTS.md module-identity rule needs no change.
  **[verified] re-confirmed at `rc.2` independently**: `packages/client/modules/src`
  (both halves) and `packages/extensions/cordis-client-runner/src` are
  **byte-identical** across `rc.1..rc.2` — registration call
  `packages/client/modules/src/client/manifest.ts:10,316,365`, bundle wrapper
  `packages/client/tsdown.client.ts:619`, `PLUGIN_ROUTE='/plugins'` with
  `<id>/client.js` `packages/client/modules/src/index.ts:225-237`
  (`fileName='client.js'` `:411,443`), `dsh.client` validation
  `manifest.ts:136-173`, and no change under `packages/host/webserver/src`.
  **The AGENTS.md module-identity rule needs no edit for `rc.2`.**
- `ConfigFormSnapshot`'s memory mode is **not** new: `persistence =
  ctx.remote.$host.isLoopback ? 'host' : 'memory'` is identical at both tags. A
  non-loopback browser already got read-only settings at 0.1.5, which is why
  `AGENTS.md` routes must-work-without-loopback UI to `settings.plugins.tab`.
  **No availability regression** — do not treat this as a 0.1.7 blocker.
- **[verified] new at `rc.2`, and the sharpest item in this document — no compile
  error anywhere.** `tool-addition` / `tool-removal` blocks **started being
  emitted**: the types existed at `rc.1` but nothing produced them, whereas
  `packages/core/agent-loop/src/agent.ts:619-633` now appends a
  `developer/message` session event built by
  `createDeveloperMessage({ source: { kind: 'tool-registry' }, content:
  [...additions, ...removals] })`. The host had to widen its own visibility rule
  to render them (`packages/client/ui-chat/src/client/contract/chat-visibility.ts:8-14`).
  Every block-type switch in our plugins — `dsh-jev-compaction`,
  `dsh-user-correction-miner/src/mining/message-text.ts`,
  `dsh-answer-review-gate`, `dsh-openviking-memory`,
  `dsh-model-safety-gate`'s taxonomy — will now meet these two block types at
  runtime while compiling clean. Treat "which block types do we handle, and what
  is the default branch" as an audit item of the cutover, not as a type fix.
- **[verified] new at `rc.2`, runtime-only:** the **Auto permission preset's
  approval moved from `'never'` to `'ask'`**
  (`AUTO_PRESET_SPEC`, `packages/interaction/permission-presets/src/index.ts:89-92`;
  `resolve()` still reports `auto` for a stored Auto whose sandbox matches under
  `never`, `:355`). `@yadsh/dsh-qa-surface` pins the pair and *refuses to start*
  on a mismatch: `src/config-resolvers/defaults.ts:66` and
  `src/config-resolvers/lockdown.ts:118` hard-pin `approvalPolicy: "never"`,
  `lockdown.ts:76-79` rejects any other value so an operator cannot opt out, and
  `src/secure-session.ts:841-848` throws `QaAttestationError("permission-preset")`
  when `permission.approval !== config.lockdown.approvalPolicy`. **A lockdown
  session on the `auto` preset fails to attest on `rc.2`.** The shipped default is
  `permissionPreset: "qa-read-only"` (`defaults.ts:67`), so this bites only
  deployments that selected `auto` — **[inferred]**, needs one stand with
  `lockdown.permissionPreset = "auto"` to confirm. This is an owner decision
  (§10, D3), not a mechanical edit.
- **[verified] new at `rc.2`, semantics only:** `ModelCatalog.routableProviders`
  now means "providers with ≥1 advertised model", not "providers an adapter
  serves" (`packages/api/session-controller/src/types.ts:160`, `catalog.ts:64-66`);
  `selectModel` **throws** `session/model-unavailable` for a model outside
  `ctx.llm.listModels(provider)` (`commands.ts:147` → `requireModel:379-383`) while
  `prompt` lost its `routeServed` precheck; and `selectModel` no longer awaits the
  default-model persistence (`:171-175`), so any test of ours that awaited the
  settings write can now race. Adjacent: `SessionObservationReader.read()` wraps
  projection failures as `SessionQueryError('SESSION_QUERY_CORRUPT_SESSION')`
  (`packages/session-query/session-query/src/observation.ts:283-292`) — a new
  catchable failure mode for `dsh-user-correction-miner`.
- **[verified] additive, worth a line in the map:** `LlmError.code` gained
  `ACCOUNT_QUOTA_EXCEEDED_CODE = 'ACCOUNT_QUOTA'`
  (`packages/llm/llm/src/error.ts:30`) — model-safety/QA classifiers that branch
  on error codes should handle it; two new remote error keys
  `session/provider-credentials-unavailable` and
  `session/provider-models-unavailable`
  (`packages/api/session-controller/src/types.ts:204-205`);
  `ApprovalRequestEvent.displayReason?`
  (`packages/interaction/user-approval/src/types.ts:72`), which **must not be
  persisted** — relevant to `dsh-session-audit` if it snapshots approval events;
  and new optional request-side surface `ToolUpdate = 'in-history' | 'addition-only'`
  (`llm/src/types.ts:407`), `ToolHistory` (`:498`),
  `GenerateOptions.toolHistory?` (`:531`), `Session.toolHistory()`
  (`packages/core/session/src/index.ts:829`), `projectToolUpdates`
  (`llm/src/content.ts:368-375`).

## 6. Mechanical version-metadata wave

[wave #511] **Executed.** Everything this section owns moved to `0.1.7-rc.2`: the
26 `compatibility.json` pairs, both `deepEqual` verify scripts, the openviking
bundle assert, the generator defaults and their test, the three root gate
fixtures, and the Requirement/Compatibility lines in plugin docs. What stayed on
`0.1.5-rc.2` records an observation rather than a claim: Phase 0 and spike findings
documents, `SPEC` baseline tags and `blob/dsh-v0.1.5-rc.2` permalinks, dated plan
notes, the `QaChangelog.tsx` entry of a released version (the file is listed here,
but rewriting a published entry is the CHANGELOG rule), the measurements in this
document, and — until #518 deleted them rather than bumping them — the two
`@deepseek-ai/dsh-agent-presets` catalog keys (§1: that name does not exist at
`0.1.7-rc.2`, and the rename left the keys with no consumer).

97 files carry the literal `0.1.5-rc.2` (excluding `node_modules` /
`pnpm-lock.yaml`). `pnpm check` does **not** cross-check the catalog against the
plugin ranges — `scripts/check-dependencies.sh` has no version assertion at all —
so a half-finished bump fails nothing. The list below is the manual gate.

[rc.2 fix] **[verified]** remeasured on `bot/500` with the command in §13:
**99** files carry the literal once `.nx/workspace-data` (generated),
`pnpm-lock.yaml`, `lib/` and `.typert-workspace/` are excluded — **83** of them
editable, because 16 are `CHANGELOG.md` and stay historical. The split:

| category | files |
| --- | --- |
| `plugins/*/compatibility.json` (lines 4–5 each) | 26 |
| markdown prose — `docs/`, per-plugin `README`/`SPEC`/`docs/*`, `.agents/skills/create-plugin/references/host-side.md` (excl. changelogs) | 47 |
| `CHANGELOG.md` — **never rewrite** | 16 |
| gate / verify / generator test scripts | 7 |
| `tooling/generators/dsh-plugin/src/index.ts` | 1 |
| `plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx` | 1 |
| `pnpm-workspace.yaml` | 1 — **left the set with #518**, which deleted the two `dsh-agent-presets` keys rather than bumping them (§1: the name does not exist at `rc.2`) |
| **total** | **99** |

[#518] The 99 above is the `bot/500` snapshot the row was measured on, before this
section's own wave moved what it owns; re-run on this card's head, the command in
§13 answers **39** files carrying the literal, **16** of them `CHANGELOG.md`, so
23 are prose and notes that record an observation at `0.1.5-rc.2` rather than a
claim about what is installed.

Also **[verified]** 10 of the 26 `compatibility.json` files declare a feature the
`rc.2` host no longer has (a `settings.installSection`-style capability line), so
they need a content edit and not only a version edit: `documents:7`, `jev:7`,
`openviking:9,16`, `plugin-log-ui:7`, `prompt-firewall:7`, `sleev:7`,
`web-fetch-authenticated:7`, `domain-experts:13`, `qa-surface:12`.

[rc.2 fix] **[verified]** two citations in the list below are stale on this
branch: the generator's own lines are `tooling/generators/dsh-plugin/src/index.ts:364,365,395,428,473`
(not `327,328,358,373`) and its test is `tests/index.test.ts:100-101` (not
`90-91`); and the catalog counts are 45 / 48 keys, not 44 / 47 (§1).

- `pnpm-workspace.yaml`: 44 `catalog:dsh` ranges `>=0.1.5-rc.2 <0.2.0`,
  47 `catalog:dsh-dev` pins, plus cordis/schemastery (§1). ~91 lines.
- 26 × `plugins/*/compatibility.json` lines 4–5: `"range"` and
  `"testedReleases"`. These are **hand-copied literals**, not `catalog:` refs
  (`compatibility.json` is not a package.json), which is why the bump is wide.
- Hard assertions that fail unless edited in the same commit:
  `plugins/dsh-openviking-memory/tests/bundle.test.ts:173-176`,
  `plugins/dsh-jev-compaction/scripts/verify-package.mjs:56` and
  `plugins/dsh-openviking-memory/scripts/verify-package.mjs:63` (both
  `deepEqual` on `testedReleases`). All other plugins pass the boolean form and
  need no script edit.
- Generator + fixtures: `tooling/generators/dsh-plugin/src/index.ts:327,328,358,373`,
  `tooling/generators/dsh-plugin/tests/index.test.ts:90-91`,
  `scripts/package-hygiene.test.mjs:41-42`,
  `packages/plugin-scripts/run-verify-package.test.mjs:58-59`,
  `scripts/check-dependencies.test.mjs:97`. Commit `cac7bd3` is the exact precedent.
- Docs: `docs/COMPATIBILITY.md:4,23,72-85`, `docs/PLUGIN_GUIDELINES.md:553-554`,
  `.agents/skills/create-plugin/references/host-side.md:3`, plus ~35 per-plugin
  README/`SPEC.md` Requirement/Compatibility lines.
- `plugins/*/CHANGELOG.md` is **historical — never rewrite**.
- `plugins/dsh-session-scope/scripts/verify-compatibility.mjs:17` regex
  `/^0\.1\.\d+-rc\.\d+$/` — `0.1.7-rc.1` satisfies it, so no edit (it only bit
  the abandoned alpha plan).
- Folded in by #520: `plugins/dsh-sleev/scripts/smoke-packed-dsh.mjs` defaulted
  to a stale `"0.1.1-rc.2"` instead of `testedReleases.at(-1)` like the sibling
  smoke scripts; it now reads `compatibility.json` and refuses an override
  outside that list.

Release mechanics: `.nx/version-plans/` is empty on this branch, so any commit
under `plugins/*` or the four release `packages/*` needs a plan file
(`.nx/version-plans/<topic>.md`, front matter `"@yadsh/<pkg>": patch` + a
changelog paragraph). A `@yadsh/dsh-qa-surface` plan additionally requires a
matching `version: "<incremented>"` entry in
`plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx` in the same
change — its manifest is `0.12.0`, so a `patch` plan needs `0.12.1`.
A docs-only commit needs neither.

[rc.2 fix] **[verified]** the two factual halves of that paragraph are wrong on
this branch now, and the next release commit will collide if it is trusted:

- `.nx/version-plans/` is **not empty** — `ls .nx/version-plans/*.md | wc -l`
  returns **39** tracked plans, 17 of which name `@yadsh/dsh-qa-surface`. The
  wave must read the *existing* plans, not assume a clean directory.
- The qa-surface pairing arithmetic has moved: the manifest is **`0.13.0`**
  (`plugins/dsh-qa-surface/package.json`) while
  `src/client/components/QaChangelog.tsx:25` already declares a pending
  **`0.14.0`** entry. So a *new* qa-surface plan pairs with **`0.14.1`** (patch)
  or **`0.15.0`** (minor), and an `0.12.x` instruction is stale. `AGENTS.md`
  makes that pairing mandatory, so getting it wrong is a gate failure, not a
  nit.
- **[verified]** the four release-managed `packages/*` are unchanged:
  `audit-core 0.1.0`, `audit-ui 0.1.1`, `plugin-kit 0.4.0`, `plugin-log 0.4.0`;
  `test-kit`, `config` and `plugin-scripts` are `private: true` and need no plan.

## 7. Suggested execution order

1. Pre-flight: re-confirm `0.1.7-rc.1` is published (it was on 2026-09-24).
2. Catalog commit: both catalogs + cordis/schemastery + the
   `dsh-agent-presets` → `dsh-agent-preset-registry` rename (9 refs) + add
   `@deepseek-ai/dsh-client-ui-plugin-manager` + `pnpm install`.
3. Decide §4.3 (host chrome vs our shell). This gates step 4.
4. Centralize the new plumbing in `@yadsh/dsh-plugin-kit` —
   `SETTINGS_PLUGIN_ITEM_SLOT` → the `plugins.row.config` helper and a
   `ConfigForm`-shaped store binding — so the 12 plugin diffs stay thin.
5. Per plugin, verify with `pnpm --filter <pkg> typecheck` (not `nx run-many`,
   which hides dependent failures): host volatile Config → client card →
   `dsh.client.inject` list → `verify-package.mjs` → tests.
6. Non-settings clusters (§5).
7. `pnpm check`, then `--skip-nx-cache` before trusting any green.
8. Only then the metadata wave (§6) and version plans. The `compatibility.json`
   `range`/`testedReleases` lines are an **evidence claim** — flipping them
   before the code compiles is exactly what they are meant to prevent.

Estimated remaining scope: ~12 plugins × (one host config file + one card + one
client index + tests) plus the clusters in §5 — roughly 100 files. Worth one
focused session with a fan-out per plugin, not a drive-by.

# Part II — `rc.1` → `rc.2`

The headline: **`rc.2` did not move the surface that makes this migration
expensive.** Every file the settings rewrite rests on is byte-identical between
the two tags, and the agent/session event catalog has an empty diff. What `rc.2`
adds is one *behavioural* change no compiler will tell us about (§8.4), one
deleted capability we assumed had merely moved (§8.6), and a packaging hazard
inside our own lockfile (§9.3). Our measured error count moved 288 → 296 on the
same 18 packages. The §4 redesign, the §4.2 recipes and the §7 order all stand.

## 8. Delta by surface

### 8.1 Settings subsystem and configuration cards — frozen

**[verified]** empty diff across `rc.1..rc.2` for all of `packages/settings/**/src`,
`client/config-form-types.ts`, `config-form.ts`, `ui-plugin-manager/src/client/slot-contract.ts`,
`config-ledger.ts`, `packages/api/settings-controller/src`, and
`packages/boot/config-editor/src`. Repo-wide `git grep` at `rc.2` still finds no
`SettingsProvider`, no `SettingsScope`, no `SettingsScopeBinder`, no
`installSection`, and `settings/updated` exists only in a stale untracked `lib/`
artifact (`git ls-files packages/settings/settings/lib/` is empty — do not trust
it). **§4, §4.1 and §4.2 are valid as written**, with the citation and API
corrections in §4.2 and §4.3a.

**[verified]** slot family unchanged: `settings.section`
(`ui-settings/src/client/contract/slots.ts:57`) and `settings.plugins.tab`
(`:66`, rendered `ui-settings-plugins/src/client/PluginsSettingsSection.tsx:58,111`)
both survive; the family is exactly launcher, trigger, header, action, close,
section, plugins.tab, onboarding, general.item — nothing added, nothing removed.
Only `settings.launcher` saw a change (`SettingsLauncherOwnerProps` gained
`settingsOpen` and `settingsShortcut?`, `:148-150`), and we do not register there.

**[verified] `ctx.settings` is an optional service and `configure()` is single-shot:**
`SettingsForms` at `packages/settings/settings/src/index.ts:223`,
`static inject = ['configEditor','profileContext']` `:224`, merged as `settings`
via `declare module '@deepseek-ai/cordis'` `:38,41`;
`configure(presentation, owner = this.ctx.fiber)` `:266` **throws on a second call
for the same fiber** `:268`; `update(ns, patch, expectedRevision?)` `:347` takes a
**plain object**, not an ops array; `replace(ns, section, expectedRevision?)` `:357`;
the write path `:377-421` enforces volatile-path checks, the revision fence,
`validatePaths` and `strip()`. All of §4.1's rules re-confirmed at these lines.

### 8.2 Client slots, renderer, theme and bundle format — 3 additions, 0 removals

**[verified]** `packages/client/ui-slots/src` and `packages/client/ui-renderer/src`
are **byte-identical** across the range, as are `store`, `connection`,
`resources`, `locale`, `modules` and `cordis-client-runner`. There is no single
slot union literal — the key domain is `keyof SlotMap & string` over the empty
merge point `packages/client/ui-slots/src/index.ts:26`, filled by per-package
`declare module` blocks; the materialised shipped list is generated at
`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:81`:
**89 keys at `rc.2`, 86 at `rc.1` — three additions, zero renames, zero deletions**:

| new slot | kind | declared at |
| --- | --- | --- |
| `shell.quota-notice` | chain, root | `packages/client/ui-chat/src/client/contract/slots.ts:329` |
| `sidebar.session.row.leading` | list, root | `packages/client/ui-workspace/src/client/contract/slots.ts:129` |
| `sidebar.session.row.hover` | list, root | same file `:134` |

**[verified]** every slot name our plugins register exists at `rc.2` **except
`settings.plugin.item`**, which is still deleted — its only remaining occurrence
in the harness is a stale prose comment
(`ui-settings-models/src/client/slot-contract.ts:11`). `ctx.slots.register`
overloads (`ui-slots/src/index.ts:1157,1184`), `BaseOptions` (`:811-834`),
`SlotRegistry.register`/`registerFactory`/`inject`
(`ui-renderer/src/client/registry.ts:181,192,209`) are unchanged — **the §4.2
client recipe needs no rework**.

Adjacent additive client changes: `ConversationBinding` gained a **required**
`openTurn: ObservableSnapshot<number | undefined>`
(`ui-conversation/src/client/conversation/assembly.ts:29-35`, member `:55`) — our
only consumer `dsh-qa-surface/src/client/QaSessionController.ts:227` holds a
reference rather than implementing it, so it is safe, but any fake of that
interface must add the member; `SidebarRightTabActions.bindCommands()` +
`SidebarRightTabCommands` + `TabRecord.refreshShortcut?`
(`ui-sidebar-right/src/client/contract/slots.ts:130-176`); `ui-layout`'s `inject`
gained `'shortcuts'` (`src/client/index.ts:143`); `SidebarRootInjected.hooks`
gained `shortcuts` (`ui-sidebar/src/client/contract/slots.ts:129`).
`IConversation` itself (`ui-conversation/src/client/service.ts:40-74`) has an
**empty diff**, so `rc.2` did not move the `dsh-draft-sessions` failure surface.
`DEVELOPER_TOOLS_VIEW_ID` → `TRAJECTORY_VIEW_ID`
(`ui-conversation/src/client/view-selection.ts:7`) is not re-exported and has zero
hits in our repo.

**[verified]** design tokens: purely additive, 90 → 93 alias names, **zero
removals or renames**; every alias `AGENTS.md`'s shell cites still exists (§4.3a
table). The real token news is the *new* `focus.css` and the first-party migration
to `0.5px … settings-card-stroke`, both in §4.3a.

**[verified]** module identity and bundle serving unchanged (§5's claim,
re-confirmed independently) — **no AGENTS.md edit needed on that rule.**

### 8.3 Agent and session events — the diff is empty

**[verified]** `packages/core/agent/src/**` untouched across `rc.1..rc.2`.
`agent/created | disposed | status | inbox/inserted | inbox/claimed |
inbox/discarded | pre-step | request | request-error | assistant-stream |
turn-stopping | error` sit at **identical line numbers** in
`runtime-types.ts:261-393` with identical payloads and `@mode`s. Cordis
`session/*` = `created | disposed | event | flush`
(`packages/core/session/src/index.ts:55-86`) unchanged. `loader/*` is still
exactly `loader/volatile-update` at both tags. `SessionEventMap` gained and lost
nothing; only doc text on `request/header` / `RequestHeaderReason` moved
(`packages/core/session/src/types.ts:266-271,390-396`). The only new events in the
whole range are `deepseek-account/session-expired` and
`deepseek-account/model-sign-in-required`
(`packages/credentials/deepseek-account/src/types.ts`), outside our dependency set.

**Consequence: there is no event migration work introduced by `rc.2`.** Everything
§5 says about `agent/session-start` → `agent/created` is an `0.1.5 → rc.1` delta.

### 8.4 LLM and session data shapes — types stable, runtime not

**[verified]** `packages/llm/llm/src/message.ts` and
`packages/core/tools/src/index.ts` decisions are unchanged, so all five §5 type
items hold verbatim (see the `[rc.2 fix]` corrections inline in §5). The three
things `rc.2` actually changes in this area, in descending order of danger:

1. **[verified] `tool-addition` / `tool-removal` blocks are now emitted** — see the
   bullet of that name near the end of §5. Type-clean, runtime-visible, affects
   five plugins. This is the single most important `rc.2` finding because the
   migration plan as written treats the block change as *only* a compile problem,
   and after the cutover the compiler will be silent about the half we got wrong.
2. **[verified] `LlmError.code` gained `'ACCOUNT_QUOTA'`** (`llm/src/error.ts:30`) —
   additive but every error-code branch should be re-read.
3. **[verified] `Session.toolHistory()` is new** (`core/session/src/index.ts:829`,
   folding from the new `tool-history.ts`), plus `ToolUpdate` /
   `GenerateOptions.toolHistory?` / `projectToolUpdates` — optional for us, and
   relevant only because `dsh-jev-compaction` compacts history that may now
   contain tool-registry churn.

### 8.5 Host runtime APIs — one real breaking signature, and we do not call it

| area | `rc.1 → rc.2` | ours |
| --- | --- | --- |
| cordis / schemastery / cosmokit | **no change** (§1) | none |
| shell (`tool-bash`, `tool-pwsh`, persistent variants) | tool **description** prose cut ~50 %, `sandbox_permissions` description now `sandboxPermissionsDescription('command')` (`tool-bash/src/index.ts:397`, `tool-pwsh/src/index.ts:408`); no exec request/response, handle, result, name or param change; `shell/shell`, `bash-local`, `bash-sandbox`, `pwsh-local`, `pwsh-sandbox`, `shell-env` have zero src diff | none — repo grep for host description strings is clean |
| output retention | one new export `truncateWithoutSplittingSurrogatePair` (`packages/util/output-retention/src/index.ts:456`); retention is **not** newly observable to a plugin | none |
| sandbox | new export `sandboxPermissionsDescription(subject)` (`sandbox/src/escalation.ts:95`, re-exported `index.ts:18`); `EscalationApprover.request` gained optional `displayReason` (`:124`) — additive | nothing to change in a manifest; `SandboxMode`, `SandboxPolicy`, `ESCALATION_TARGETS`, `WIDER_MODES`, `roots.ts` identical |
| workspace | **[verified] breaking**: `initializeDefault(resolveDirectory: () => Promise<{path,title}>)` → `() => Promise<string>` (`packages/workspace/workspace/src/index.ts:256`), title now derived from the requested path (`:271`); `WorkspaceInitializeDefaultRequest` **deleted** and `@Remote initializeDefault(signal)` (`api/workspace-controller/src/index.ts:98`); `defaultWorkspaceDirectory()` lost its first param; new subpath `…/default-workspace` | **[verified] zero call sites** in this repo — `dsh-qa-surface` imports `WorkspaceId` only, `dsh-draft-sessions` imports the `IWorkspaces` type. `api/workspace-files/src/index.ts:308,316-319`: `list` now follows `symlink` entries and stats the target (same error code) — `dsh-documents`/`dsh-lightrag` gain behaviour, not breakage |
| tools registry | `PreToolDecision.ask` gained `displayReason` (`core/tools/src/index.ts:611`); `defineTool`, `ToolDefinition`, `ctx.tools.register` (`:1063`), `tools/pre-execute`/`post-execute` (`:153,176`), `PostToolDecision`, `ToolExecutionResult` all unchanged. Dynamic tool updates land in `llm` + `agent-loop` + `core/session`, **not** the registration API | a plugin registers tools exactly as before |
| typert (`protocol`, `registry`, `loader`, `generator`) | **[verified] no change** — the diff is `package.json` version fields and READMEs only | safe; `packages/audit-ui`, `plugin-log` and the typert-based cards need nothing new |
| storage / credentials / permission-presets | `packages/storage/{storage,storage-domain,storage-sqlite}` and `dsh-credentials*` src **unchanged**; `storage-json/src/format.ts:72` now rejects an array `tables` with `malformed-medium`; `permission-presets` Auto → `approval: 'ask'` (§5) | `ctx.storageDomain.open` safe; the Auto change is D3 in §10 |
| subagent | `SubagentRuntime.listDescendants(rootSessionId, signal?)` keeps its signature; `SubagentCatalogRow`/`SubagentListEntry`/`SubagentDescendantListEntry` keep their fields (`subagent/src/control-types.ts:24-67`) | `dsh-tool-offload`/`dsh-domain-experts` import only untouched types |
| skill registry | **[verified] unchanged** — `packages/skill/{skill,skill-filesystem,skill-badge,skill-office,tool-workspace-dependencies}/src` identical; only `tool-skill/src/index.ts:83` reworded a description, plus a `libreoffice-kit ^0.1.0→^0.1.1` dep bump | nothing for `dsh-documents`/`dsh-openviking-memory` |

### 8.6 Preset registry — a capability deleted, not relocated

See the `[rc.2 fix]` on §5's "Preset registry face": `authorable`/`copy` never
came back, `modeSelectionEnabled` is now gone too, `standingKeyFor` does not
exist, and durable preset authoring has no Host path. This converts
`dsh-preset-persona-editor` from "one type error" into decision **D2** (§10).

### 8.7 Remote surface

**[verified]** `@Remote` count in `api/session-controller` 18 → **19**; the
addition is `initializeDefaultModel(): Promise<void>`
(`packages/api/session-controller/src/index.ts:281-303`). All 15 named remotes we
touch (`list, page, create, fork, prompt, cancel, selectModel, modelCatalog,
projections, search, rename, attachment, updateQueue, openWorkspacePath,
workspacePathApplications`) keep their argument shapes. `packages/api/remotes`
now also mounts `scheduleRemote` in the browser
(`src/client/index.ts:44,178`) and forwards three more events; **nothing our code
calls was removed or renamed.** So the remote layer is `rc.2`-neutral for us; the
`dsh-qa-*` remote-side errors come from the client conversation types, not here.

## 9. The `rc.2` trial bump, measured

Run in this worktree on `bot/500` against the harness `dsh-v0.1.7-rc.2` catalog
targets. All four commands were executed for real; §13 has them verbatim.

### 9.1 What was changed (and then reverted)

- `pnpm-workspace.yaml`: 43 `catalog:dsh` ranges → `>=0.1.7-rc.2 <0.2.0`,
  46 `catalog:dsh-dev` pins → `0.1.7-rc.2` (93 lines touched), cordis
  `^4.0.2`/`4.0.2` → `^4.0.4`/`4.0.4`, schemastery `^3.18.2`/`3.18.2` →
  `^3.18.4`/`3.18.4`.
- the `dsh-agent-presets` → `dsh-agent-preset-registry` rename (9 refs, 7 files)
  plus `@deepseek-ai/dsh-agent-preset` and
  `@deepseek-ai/dsh-client-ui-plugin-manager` added to both catalogs. **This is the
  minimum needed for `pnpm install` to resolve at all** — see §1's note that the
  rename cannot precede the bump.

### 9.2 `pnpm install` — green

**[verified]** exit **0**, "Done in 20.2s using pnpm v10.4.1". `cordis@4.0.4` and
`schemastery@3.18.4` land. It does emit peer warnings we should not learn to live
with: 10 × `unmet peer @deepseek-ai/dsh-invariants@0.1.7-rc.2: found 0.1.1-rc.2`,
2 × `dsh-storage`, 2 × `dsh-user-approval`, 2 × `dsh-sandbox-policy`, 1 ×
`dsh-session-projection`, 1 × `dsh-session-persistence`, 1 ×
`dsh-launch-environment`, 3 × `@deepseek-ai/cordis-plugin-include@~1.0.9: found 1.0.6`.
Root cause and remedy: §1's dual-tier note.

### 9.3 `nx run-many -t build` — red

**[verified]** **14 failed**, **4 not run** (blocked on their own dependencies):

- failed: `dsh-documents`, `dsh-preset-persona-editor`, `dsh-domain-experts`,
  `dsh-model-safety-gate`, `dsh-plugin-log-ui`, `dsh-web-fetch-authenticated`,
  `dsh-jev-compaction`, `dsh-prompt-firewall`, `dsh-answer-review-gate`,
  `dsh-doc-impact`, `dsh-ui-repair`, `dsh-draft-sessions`,
  `dsh-user-correction-miner`, `dsh-sleev`
- not run: `dsh-openviking-memory`, `dsh-qa-surface`, `dsh-qa-integrations`,
  `dsh-qa-browser`

Real compiler output, with the sites that carry information (§13 has the raw log
extraction):

```
dsh-jev-compaction   src/client/card.tsx(15,15):  TS2305 Module '"@deepseek-ai/dsh-client-ui-settings/client"' has no exported member 'SettingsScope'
dsh-jev-compaction   src/client/card.tsx(51,31):  TS2344 '"settings.plugin.item"' does not satisfy …
dsh-jev-compaction   src/dsh/surface.ts(75,40):   TS2339 Property 'content' does not exist on type 'ContentBlock'
dsh-jev-compaction   src/config.ts(854,14):       TS2742 inferred type of 'JevCompactionConfigSchema' cannot be named without a reference to …/@deepseek-ai/schemastery
dsh-answer-review-gate src/index.ts(146,21):      TS2322 Type '"plugin"' is not assignable to type '"model" | "user" | "tool" | "system-prompt"'
dsh-user-correction-miner src/mining/message-text.ts(5,7): TS2367 '"…|tool-addition"|"tool-removal"' and '"tool-result"' have no overlap
```

**[verified] `TS2742` is new to this document and is a build-only failure** — 3
occurrences under `nx build` (declaration emit), **zero** under
`pnpm -r typecheck` (`--noEmit`). It would therefore have been invisible to the
§3-style measurement alone. Sites: `dsh-jev-compaction/src/config.ts:854`,
`dsh-jev-compaction/src/service.ts:131`, `dsh-user-correction-miner/src/config.ts:134`
— all three are an exported `Config`/schema const with no explicit type
annotation. Fix is either the catalog completeness work in §1 or a `: Schema<…>`
annotation on those three consts.

**[verified on `63fea21`, #515] the `dsh-jev-compaction` pair of those three is
gone, and by the first of the two remedies.** After #509 closed the catalog and
#511 moved the manifests, `npx nx build dsh-jev-compaction --skip-nx-cache`
emits no `TS2742` — and none appears once the schema's editable leaves carry
`.volatile()`, which is the change that would have surfaced a
`Volatile<…>` reference in the inferred type. A declaration-emit probe of the
pre-migration `src/config.ts` on this tree (`tsc --declaration
--emitDeclarationOnly`) exits 0 as well, so the site stopped reproducing before
any source was touched. No annotation was added, and none is needed: the const
stays inferred. Do not re-open this as missing work when reading the §11 row.

### 9.4 `pnpm -r typecheck` — red, and under-reports

**[verified]** the literal command the card asked for **stops at the first failing
project** (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, at `@yadsh/dsh-draft-sessions`),
showing 13 errors and then exiting. The honest number is
`pnpm -r --no-bail typecheck`: **[verified] 296 errors across 18 projects** —
the *same* 18 projects as `rc.1`, at 288. `packages/*` contributes **zero**, and
`tooling/*` contributes zero, confirming §3's blast-radius claim at `rc.2`.

Per package, `rc.1` → `rc.2` (both measured the same way, catalogs only, no
source fixes):

| Package | rc.1 | rc.2 | Δ | dominant cause at rc.2 |
| --- | --- | --- | --- | --- |

Error-class frequency at `rc.2`, counted on `error TS` lines only:
`'settings' is of type 'unknown'` ×57, `Property 'X' does not exist on type 'Y'`
×39, `no exported member 'SettingsScope'` ×16, `Type '"settings.plugin.item"' does
not satisfy` ×12, `'snapshot' is of type 'unknown'` ×9,
`Property 'settingsScope' does not exist on type 'Context'` ×9,
`installSection does not exist on type 'SettingsForms'` ×8,
`Property 'schema' does not exist on … TypertSchema` ×9,
`Cannot find module '@yadsh/dsh-qa-surface/client/{settings,panels}'` ×9 (pure
cascade), `qaSurfacePanels does not exist on type 'Context'` ×5,
`SettingsProvider`-era test fakes `TS2610` ×3 + `TS4113` ×6.

**[verified] three classes this document did not itemise before, all present at
`rc.2` and each with a real call site:**

1. **typert remote `schema`** — `Property 'schema' does not exist on
   '{ readonly mode: "strict"; readonly typeSymbol: string; create; decode?; encode? }'`,
   8 × `dsh-qa-browser` and 1 × `dsh-draft-sessions/src/remote.ts:80,84` plus
   `tests/remote.test.ts:30`. **[verified]** `packages/typert/*` src has **no**
   `rc.1..rc.2` diff, so this is an *un-itemised `0.1.5 → rc.1`* break, not new
   `rc.2` work — it was hidden inside the `qa-browser: 24 / draft-sessions: 13`
   totals both times. Do not add it to the `rc.2` delta column.
2. **`MemorySettings` test fakes no longer conform to `SettingsForms`** —
   `dsh-plugin-log-ui/tests/integration.test.ts:14,21,25`,
   `dsh-prompt-firewall/tests/settings.test.ts:14,21,25`
   (and `dsh-model-safety-gate/tests/integration/settings.test.ts:19,21,26,30`
   until #517 deleted that one):
   `TS2610 'writable' is defined as an accessor in class 'SettingsForms', but is
   overridden here in 'MemorySettings' as an instance property` and
   `TS4113 This member cannot have an 'override' modifier because it is not
   declared in the base class 'SettingsForms'`. Each of the three plugins declares
   its own fake, so the fix is 3 files — or one shared fake promoted into
   `@yadsh/dsh-test-kit`, which is the better call and is why `test-kit` appears
   in §11 despite having no error of its own. **[verified #517]** the
   `dsh-model-safety-gate` copy is gone rather than repaired: at `rc.2` a plugin
   installs no namespace of its own, so the fake had nothing left to stand in
   for. Two copies remain for the promotion.
3. **`rc.2`-new session-state and preset reads inside `dsh-qa-surface`** — this is
   where the `+7` lives: `src/client/QaSessionController.ts:1644`
   `subagentsByParent` gone from `SessionListState`;
   `src/client/project-session-state.ts:75` `queue` gone from `SessionSnapshot`;
   `src/index.ts:561` `standingKeyFor` gone from `AgentPresetRegistry`;
   `src/client/QaTranscriptAdapter.ts:476` `node.provenance` → `node.producer`.
   **[verified]** these are the only genuinely *new* compile errors attributable
   to `rc.2` itself in the whole repository.

**[verified] re-measured on `bot/531` (post-#509 `dsh-v0.1.7-rc`), and the larger
number is an artifact, not new breakage.** The same
`pnpm -r --no-bail typecheck` on a freshly installed worktree reads **418 errors
across 20 projects**. All 116 `Cannot find module` errors name `@yadsh/*` workspace
packages and **none** names `@deepseek-ai/*` — the unbuilt-`lib/` cascade §9.6
warns about, not a host API change. The two projects beyond the 18 above,
`dsh-session-audit` (18 × TS2307 + 4 × TS7006) and `packages/audit-ui`
(4 × TS2307 + 2 × TS7006), are *entirely* that cascade. Compare against 296/18 only
on a tree where `nx run-many -t build` has populated `lib/`; §9.4's own numbers
stand. `dsh-session-scope` reports zero errors under both readings.

### 9.5 `npx nx run-many -t test` — 14 projects green, 18 never ran

**[verified]** the suite is gated behind the build: **18 `test` targets were not
run** because the 14 builds above failed (plus `dsh-session-audit`'s and others'
dependency chain). The 14 projects that did run are **all passing**, 113 test
files, zero failures:

`dsh-test-kit` 3 · `dsh-plugin-log` 1 · `dsh-audit-core` 5 · `dsh-plugin-kit` 4 ·
`dsh-audit-ui` 3 · `dsh-cas-results` 15 · `dsh-session-audit` 8 ·
`dsh-session-scope` 17 · `dsh-l10n-overrides` 17 · `dsh-kv-persist` 11 (+1 skipped) ·
`dsh-tool-offload` 14 · `dsh-lightrag` 9 · `dsh-git-readonly` 12 ·
`dsh-plugin-generator` 2

**[verified] so `rc.2` tells us nothing new about test behaviour**: the 18 blocked
suites are exactly the 18 type-broken packages. The runtime hazards in §5
(`agent/created` `@mode serial`, the `auto`-preset attestation, emitted
tool-change blocks) are **not** covered by any failure this run produced — they
need the stands in §12 step 6, not `nx test`.

**[#514 fix] that sentence is about the measured run, not about the cutover.**
Once a package's own types compile, its suite still cannot load if its host entry
uses a `@Remote(...)` decorator: the `rc.2` lockfile's vite 8 SSR transform
lowers nothing and Node 24 rejects the leftover `@(...)` syntax, so
`SyntaxError: Invalid or unexpected token` is thrown at import with no frame.
Observed in `dsh-qa-integrations` (`tests/plugin.test.ts`,
`tests/credential-help.test.ts`) on untouched `HEAD`, and again in
`dsh-domain-experts` (`tests/wiring.test.ts`), i.e. it is a toolchain cost of the
relock rather than a migration item in any §11 row. `dsh-qa-integrations` passes
810 of 810 tests with those two files pointed at the compiled `lib/` entry, which
is how this card verified its host half.

### 9.6 Baseline control

**[verified]** the same four commands on the untouched `0.1.5-rc.2` tree in this
worktree, after `--skip-nx-cache`: `nx run-many -t build` exit **0** with **0**
`error TS`; `pnpm -r --no-bail typecheck` exit **0** with **0** errors. So every
number in §9.4 is attributable to the version bump and none to pre-existing
rot — an earlier pass of this control read 77 errors, which turned out to be
`lib/` output deleted by the failed `rc.2` build's `clean` step, i.e. a
measurement artifact. **A future control must cache-bust the build first**,
otherwise `Cannot find module '@yadsh/dsh-qa-surface/client/settings'` is counted
as baseline breakage.

## 10. Open owner decisions

**D1 — the settings card shell (§4.3, §4.3a) — reopened and REDECIDED 01.10: option 1.**

The owner's word of 26.09 (#508) was option 2: our shell stayed ours, `AGENTS.md`'s
canonical CSS and `verify-plugin-card-contract.mjs` were not edited, and neither
`settings.plugins.tab` nor `plugins.row.config` was re-styled to the host chrome. Twelve
cards landed on that reading, and `dsh-qa-surface` (#513) and `dsh-plugin-log-ui` (#521)
registered `settings.plugins.tab` with the `<li>` inside a plugin-owned `<ul>` because a
list slot hands its registrant no props — that shape is still what those seats require.
On 01.10, seeing the 12px/1px/2px shell next to `rc.2`'s 20px/0.5px first-party rows on a
live stand, the owner reversed it: **"as the host does" — option 1.** The history above is
kept because it explains why the twelve rows read the way they do; it is not an
instruction.

What option 1 means in this repository now:

- On `plugins.row.config` and `plugins.bundle.config` the bundle renders **the body
  only**. The page draws the card surface, the title, the row id and the description, so
  our `dsh-plugin-card*` classes, our 14×14 chevron and our `<li>` root are forbidden
  there — a second frame beside a first-party row is the defect this decision removes.
- `AGENTS.md` and the shared gate **are** edited, against the 26.09 wording: the contract
  is now derived from the seat the bundle registers on, so the same file that once
  required the shell rejects it on the panel seats (§4.3a, §4.3).
- Focus treatment comes from the Host's `--dsw-focus-ring-*` tokens with fallback lengths,
  never from a hard-coded outline: `focus.css` wins on specificity (0-3-2 against 0-2-0)
  under pointer modality, so a ring of our own is invisible after a mouse click, and
  raising specificity is the wrong repair.
- The seat key `<package name>#<row id>` and the settings namespace it resolves are not
  chrome and stay untouched — moving them orphans the values a user already saved.
- Cards seated in `settings.section` and `settings.plugins.tab` still own their whole
  card; those seats keep the canonical shell.

Scope as of 01.10: one of the thirteen series packages is seated on the row today
(`dsh-model-safety-gate`, #653), so the contract landed with that one migrated and the
other twelve — still on `settings.plugins.tab` — are named in the epic (#646) as the
second step, each on its own card.

**Fact that survives either branch:** `scripts/verify-package-hygiene.mjs:49,816-835`
keyed the *entire* card-contract enforcement off a source file containing the literal
`settings.plugin.item`; once plugins register `plugins.row.config`, that gate stops
firing and the shell contract becomes unenforced unless the constant is retargeted.
**[verified]** line 49 and the block at 816-835. **Retargeted by #510:** the gate now
fires on `settings.plugin.item`, `plugins.row.config`, and `settings.plugins.tab`
combined with the shell, so enforcement survives whichever way D1 goes.

**D2 — preset authoring (`dsh-preset-persona-editor`) — newly open.** §8.6:
the copy-to-writable-root capability does not exist at `rc.2`, and neither does
`modeSelectionEnabled` or `standingKeyFor`. Owner must choose between shipping the
editor as read-only + `select`, or writing preset YAML/registration through a
plugin-owned path (the plugin then had its own file IO in
`src/host/preset-reader.ts` — `readFile`/`createHash`/`node:path`, which the
option below deleted along with the writer, so reviving option 2 starts from no
file IO at all) and owning durability plus the `agent-preset`
compatibility implications. This is a feature decision, not a migration step.
**[decided 2026-09-27, #508] Option 1 — read-only, no `select` here.** Landed in
#518: the roster face the plugin reads is `list`/`resolve`/`readDocument`/
`defaultId`, `save`/`reset`/`copy` and `src/host/preset-writer.ts` were removed
in one commit — which is **not** a reversible unit by itself: reverting that
commit on top of the read-path commit conflicts in 20 paths at `296b8836`, the
last code commit of this series, and puts the writer back against helpers (`readPresetFile`,
`revisionOf`, `preset.path`) the read-path migration deleted, so it does not
compile. A
reversal of D2 is a revert of the whole #518 series. #605 carries the blocker for
returning persona edits to the screen. `select` takes a live `Agent`, which a
settings page does not have, so the read-only build did not grow a session
surface; see §5's registry bullet for the landed shape and the file-by-file list.

**D3 — the `auto` permission preset vs qa lockdown (§5, §8.5) — newly open.**
`dsh-qa-surface` hard-pins `approvalPolicy: "never"`, refuses any other value
(`lockdown.ts:76-79`), and throws at attestation on mismatch
(`secure-session.ts:841-848`). `rc.2` resolves `auto` to `ask`. Either the pin
accepts `ask` for `auto`, or lockdown documents that `auto` is not a valid
lockdown preset and rejects it earlier with a clear error. Needs one stand to
confirm the failure mode first (§12 step 6).
**[decided 2026-09-26, #508] `auto` stays an invalid lockdown preset:** refuse it
earlier and clearly, keep the `approvalPolicy: "never"` pin unweakened, and cover
the refusal path with a test. Landed in #513 — `resolveLockdown`
(`plugins/dsh-qa-surface/src/config-resolvers/lockdown.ts`) rejects
`permissionPreset: "auto"` while lockdown is enabled, so a deployment fails at
configuration instead of failing attestation one chat at a time. The failure mode
was read from the sources cited above; the physical lockdown stand of §12 step 6c
has still not been run.

**D4 — catalog completeness / the dual framework tier (§1, §9.2) — mechanical
with one judgement call.** Adding the 17 uncovered DSH names to both catalogs is
the clean fix and keeps `pnpm install`'s peer warnings honest; a root
`pnpm.overrides` block is the cheap fix. The call is whether we accept 17 more
catalog keys as policy (they then join §6's wave on every future bump) or an
override that hides drift. Recommendation: catalogs, because the warnings are the
only signal we get.

**Not open, resolved by this pass:** the `plugins.row.config` host counterpart
question (§4.3a item 1), the preset-registry relocation question (§8.6, answer:
it did not relocate), module identity and the `AGENTS.md` client-bundle rule
(§8.2, no edit needed), and the loopback/memory-mode availability worry (§5,
confirmed not a regression).

## 11. Work breakdown by package

Class: **mechanical** = §6 wave only · **code** = real API migration ·
**decision** = blocked on a D-item above. Line counts are edits to our files,
excluding the shared 2-line `compatibility.json` wave each row also carries.

| Package | class | what changes | our files (line refs) | ~lines | covering tests |
| --- | --- | --- | --- | --- | --- |
| `@yadsh/dsh-plugin-kit` | **decision → do first** | `SETTINGS_PLUGIN_ITEM_SLOT` → `plugins.row.config` helper; `ConfigForm`-shaped binding (`ctx.configForms.get<T>(ns)`); `card-shell.tsx`/`chevron.tsx`/`plugin-card-css.ts` die only under D1 option 1 | `src/client/register-settings-card.tsx:56,93,116` **[verified]**, `src/client/settings-store.ts:3` (survives — structural over `subscribe`/`getSnapshot`), `src/client/card-shell.tsx:34-57`, `src/client/chevron.tsx:13`, `src/client/index.ts:17,19-21` — **note from #513:** under D1 option 2 a tab registration takes `id`/`order`/`label` and no `key`, which `SettingsCardOptions` does not carry, so `dsh-qa-surface` calls `ctx.slots.inject/register` directly and uses only `injectCardStyles` + `bindSettingsExternalStore` from this kit; the shell CSS and `CardShell` survive untouched | 60 | none of its own (4 files pass today); exercised by every plugin client test |
| `@yadsh/dsh-plugin-scripts` | **decision** | canonical shell CSS + chevron assertions; `deepEqual` capability | `verify-plugin-card-contract.mjs:4-15,39,44-45` **[verified]**, `run-verify-package.mjs:45,169-174`, `run-verify-package.test.mjs:58-59` (version literal) | 25 | `run-verify-package.test.mjs` |
| repo root `scripts/` | **decision** | `SETTINGS_CARD_SLOT` constant must follow D1 or the gate goes blind (§4.3a) | `verify-package-hygiene.mjs:49,816-835` **[verified]**; `package-hygiene.test.mjs:41-42`; `check-dependencies.test.mjs:67,69,131` | 15 | `package-hygiene.test.mjs` |
| `@yadsh/dsh-test-kit` | code | host **one** `MemorySettings` conforming to `SettingsForms` (accessor `writable`, no stray `override`) so 3 plugins share it — no error of its own today | new/changed fake in `packages/test-kit/src/**`; current copies at `dsh-model-safety-gate/tests/integration/settings.test.ts:19-30`, `dsh-plugin-log-ui/tests/integration.test.ts:14-25`, `dsh-prompt-firewall/tests/settings.test.ts:14-25` **[verified]** | 30 | `dsh-test-kit` 3 files pass today |
| `dsh-session-scope` | **mechanical**, debt blocked | **[verified] no mandatory edit** — clean at `rc.2`: build, typecheck, lint and 17 test files (98 pass / 1 skip) green, no `TS2742`, and `src`+`tests` have zero hits for any removed identifier (`settings.plugin.item`, `SettingsScope`, `installSection`, `standingKeyFor`, `agent/session-start`, …). It registers no settings card (so D1 does not gate it), reads no `block.type` (so §5's emitted `tool-addition`/`tool-removal` cannot reach it) and never touches `approvalPolicy`/`permissionPreset` (so D3 does not either) | The 10 `src` refs the row already listed are **8 calls + 2 declarations in our own structures** (`host-api.ts:24`, `scope-delegation.ts:22`) — the old prose "8 calls" counted the calls only; `tests/` adds **18** more (§13.2). All 10 line refs verified exact. Blocked as a unit by §5's "no replacement at `rc.2`" finding: `src/{host-api.ts:24,57,index.ts:141,497,scope-delegation.ts:22,49,57,84,scope-fs.ts:121,140}` | 0 mandatory; 2 if only the `seq` slice is taken | `tests/{host-api,scope-delegation,scope-fs,scope-remote,tool-guard-*}.test.ts` (17 pass today) |
| `dsh-tool-offload` | **mechanical** | shell/sandbox untouched §8.5; one fixture source kind | `compatibility.json:4-5`; `tests/unit/parent-context.test.ts:29` `kind:"plugin"` | 5 | `tests/unit/parent-context.test.ts` (14 files pass today) |
| `dsh-kv-persist` | **mechanical** | metadata only | `compatibility.json:4-5` | 2 | 11 test files pass today, unchanged |
| `dsh-cas-results`, `dsh-git-readonly`, `dsh-lightrag`, `dsh-l10n-overrides` | **mechanical** | metadata only | `compatibility.json:4-5` each | 2 each | 15 / 12 / 9 / 17 files pass today, unchanged |
| `dsh-session-audit` | **mechanical** | client slots all survive (§8.2); `ApprovalRequestEvent.displayReason` is moot here — the package reads audit artifacts off disk and ingests no session events (`approval` over `src`/`tests`: zero hits), so it has nothing to persist | **none of our own**: `compatibility.json:4-5` and `README.md:110` both belong to #511's wave; `SPEC.md:261` and `docs/ARCHITECTURE-NOTES.md:4-5,10,42` record the `0.1.5-rc.2` verification pass and stay historical | 0 | measured on the `rc.2` catalogs at `05d8235`: `pnpm --filter @yadsh/dsh-session-audit check` green — 8 files / 88 tests, typecheck exit 0, `verify-package: all gates passed`; repo-wide `pnpm -r --no-bail typecheck` fails 17 projects and this is not one of them, `TS2742` 0 |
| `@yadsh/dsh-audit-core`, `@yadsh/dsh-audit-ui`, `@yadsh/dsh-plugin-log`, `@yadsh/dsh-config` | **nothing** | typert unchanged §8.5; grep for every migrating identifier returns zero (`audit-core/src/types.ts:113` `provenance` is its own schema field) | — | 0 | 5 / 3 / 1 / — pass today |
| `dsh-preset-persona-editor` | **decision (D2) → landed #518** | registry rename `dsh-agent-presets` → `dsh-agent-preset-registry`; the roster face has **no** replacement for `authorable`/`copy`/`trust`/`path` — the read half moves to `list`/`resolve`/`readDocument`/`defaultId`, and the write half (`save`/`reset`/`copy`, `src/host/preset-writer.ts`, the four Config ceilings) is removed in its own commit, which **does not revert on its own** — replayed over the read-path commit it conflicts in 20 paths at `296b8836`, the last code commit of this series, and restores a writer against `readPresetFile`/`revisionOf`/`preset.path`, all deleted by that commit, so §10's D2 bullet counts the reversal as a revert of the whole #518 series. `select(agent, id)` needs a live `Agent`, so the settings page never took it. **No D1 dependency** — the page registers `settings.section`, which survives `rc.2` unchanged, and the card shell is asserted untouched. **[review round]** two facts the face alone does not tell, driven through the installed `0.1.7-rc.2` class over a hand-seeded definition rather than read off its types: `resolve()` and `readDocument()` **reject** `agent-preset/not-found` for an id they do not hold (neither answers `undefined`), and `readDocument()` renders a **broken** preset's declarations without consulting `diagnostic()` — so "cannot compose" and "nothing to read" are different answers and the page must not merge them; `editable`, which did, is off the wire, and a refusal now carries the registry's own reason to the card and to `preset-persona.composition-refused`. A registry answering no `readDocument()` — legal inside the `<0.2.0` half of the range — used to make every row silently unreadable. **[second review round]** three more facts the read path owed: a host that answers `readDocument()` with a value that is not a composition is refused at the read, because `inspectPreset` discriminated the union on `composition === null` while `readDocument()` read the same field through `composition?.content` — that answer reached the card as `Cannot read properties of undefined (reading 'content')`, the one place this page showed a `TypeError` where it promises words; the sections list is keyed `name:index`, since the reader drops an unnamed row and keeps a duplicate, so a hand-edited composition may name one section twice, and `SPEC.md` §1.20 states what the page then says about the collision (nothing — refusing it is the harness's job and this page has no write left to refuse it with); and `tests/service.test.ts` drives the shared `preset-roster.helpers` face instead of its own copy, so both host shapes are covered at the service and not only at the reader. **[third review round]** three facts about a check that cannot fail. A refused roster refresh wrote its reason into `state.error` while leaving `status` at `"ready"`, and the roster screen reads `error` only in its `failed` branch — the rows stayed on screen presented as current, and `client-store-page-controller.test.ts` asserted that very pairing, which is what a field no branch renders degenerates into; the reason now goes into the notice slot this screen does render, and the case is asserted on the rendered page (`PersonaPage` drawn at all, for the first time in this package) because the controller and the JSX were each checked against themselves and never against each other. `state.error` is non-empty only where `failed` renders it. The section-rule cases had fallen from the base's `rejects.toMatchObject({ code: "preset-persona/invalid" })` to a bare `toThrow()` when the writer that raised the code was removed — a `TypeError` inside `validateSections` satisfies the latter and leaves the rule it crashed on untested — so every case names the code and the sentence its own rule answers with, and the ceiling fixture left `cases.slice(0, 5)` / `cases[5]`: an index coupling that silently moves a case from the loop to the ceiling test when one is inserted in the middle. Two assertions queried `[data-testid="persona-unreadable"]`, an id no file in the package renders since the warning carrying it was deleted in the first round — `toBeNull()` over a selector that matches nothing is the one assertion that survives any change to the markup — and count the paragraphs carrying the sentence instead. The same divergence in method form, one step behind this round's own change: a notice that now holds a refresh refusal stays on the screen, and `dismissNotice()` on the controller had no JSX reaching it, so the notice carries a dismiss control named by its own text — pressed by that name in the suite, which is also how an unbound handler becomes a failing test rather than a user's dead click. **[fourth review round]** one sentence, and it was this row's own correction undone: §0 of `SPEC.md` still promised "one commit is what brings them back" after the second round had written the opposite into three other places — a summary that contradicts its own correction is worse than a missing correction, because the next reader takes the summary. §0 now says what the other three say. Putting a number in that sentence is what made it rot: the merge-tree replay conflicts in 20 paths (17 content, 3 modify/delete) at this series' head, `tests/service.test.ts` and `tests/prompt-sections.helpers.ts` having joined the set with the third round's edits, `src/host/errors.ts` with the fifth round's comment sweep, and `src/client/store.ts` with the sixth round's roster control, so the five places stating it — this row, §8.6 above, §10, `SPEC.md` §0 and the version plan — state 20 and name the commit the count was taken at. The same round checked its references against what they name instead of trusting them: `README.md` bounded the host's refusal text by "§5 of `SPEC.md`" — §5 is the scenario list, the identities-not-locations rule is §2 — and §5's registry bullet said this plugin's `src/index.ts` is 111 lines, true of `df9f26f3`, the tag the never-existed citation is judged against, 94 after this cutover. **[fifth review round]** the wording the third round named, which outlived two more rounds because it was a comment and not a behaviour: the page's own header still said the roster's cards each open "its persona editor" and that "the thing it edits is a composition file", the slot comment still said this page "edits one field of what that page composes", `verify-package.mjs` still justified its node-built-in gate with "the browser half edits text", and `invalid()` still described a write request the namespace no longer has — four sites, with two more of the same class beside them: the headers of `src/host/{validation,composition}.ts`, which spoke of refusals that happen "before anything reaches the file system" in a plugin that stopped touching one at `7821bd30`, and `NO_READ_DOCUMENT`, credited to "the host's own words" while `SPEC.md` §2 and `README.md` of this same diff assign exactly those two refusals to the page. Comments only, no behaviour, and the gate still asserts what it asserted. Two doc facts that had outlived their subject: §10's D2 paragraph, which this card rewrites three lines under itself, still offered option 2 the premise that "the plugin already has its own file IO in `src/host/preset-reader.ts`" — the removed file IO is what the decided option deleted, so whoever reopens D2 would start from none — and `docs/COMPATIBILITY.md` still named `schemastery` among this package's peers after the Config took it out; nothing checks that matrix (`grep -rl COMPATIBILITY.md scripts packages/*/scripts plugins/*/scripts` is empty) and no other file carries it, so this row is where it is fixed. One shape that was wrong in code: Cordis builds a plugin with `new callback(ctx, config)` (`@deepseek-ai/cordis/lib/index.js:1068`) and `resolveConfig` hands that row through untouched when the runtime declares no `Config` (`:956-957`), so the second parameter of `PresetPersonaEditor` — documented and typed as the test seam — received the operator's configuration in every deployment, and only a test ever passed a seam there. Harmless while the body reads `.logger` off it, and harmless now, with one difference: the parameter is `(ctx, config, deps)` the way `dsh-qa-browser` has it, the config slot is declared, named and unread, a case hands a leftover row of ceilings to slot two and fails on the slot-three logger if anyone collapses them again, `README.md` tells the operator that `allowComplete`, `maxPersonaBytes`, `maxSections` and `maxSectionsBytes` in a deployment row change nothing, and `SPEC.md` §2's rule about whose words a refusal is stays the rule the reader finds. The bump level four rounds left unasked is answered where `docs/RELEASING.md` says it is chosen: `minor`, because a `major` on a `0.1.2` package does not mark the break, it publishes `1.0.0` — no package this repository ships has reached it (highest `dsh-qa-surface` at `0.13.0`, no `1.x` heading in any changelog, no version plan ever declaring `major`), so below `1.0` the breaking step is the one this wave's sibling cut-over (#515) took; the plan says so, names §9.3's contrary letter, and points at the line the owner changes if they want the break announced at `1.0.0`. **[sixth review round]** six things the screen, the log and the published page owed, all measured against the installed `0.1.7-rc.2` class: the registry answers `broken` as a **tree** — `diagnostic()` is `[...failed, ...pending].join("\n")` over `mountDetail()`, which nests a wrapped cause under `- ` with `\n  ` continuations (`lib/index.js:208-247`) — and the page handed that tree to two blocks styled with no `white-space`, so the promise "the registry's own words" was kept letterwise and lost structurally: one run-on line, glued to the persona state by the description's ` · `. Fixed by what each block is: the shell's description stays one line (its rules are shared with every first-party card and `AGENTS.md` keeps them identical, so pre-formatting it from here is not on the table) and carries the tree's own first line — the row that refused — while `.preset-persona__error` took `white-space:pre-line`, so the whole tree, breaks included, is what the opened card states. `preset-persona.composition-refused` fired per row, where `NO_READ_DOCUMENT` and `NO_COMPOSITION_TEXT` are facts about the **host**, which either publishes `readDocument()` or does not: N presets, N identical `warn` lines on every visit to Settings. Now grouped by reason after the parallel walk, in the roster's order — a granularity the reader's own test had never asserted, `readCatalog(roster, logger)` being called with a logger and nothing said about it. The composition was read with the **request** id while `resolve(id?)` answers the deployment's default (`const wanted = id ?? this.defaultId`, `lib/index.js:604`) and `readDocument()` looks its id up exactly, no fallback (`:620-622`) — unreachable through the typed Remote, permitted by the face's own optional parameter, and it would have paired the default preset's document with `readError: Unknown agent preset: undefined`; the reader asks with `preset.id` now. Two checkboxes carried `disabled` where the textareas beside them carried `readOnly`, so a keyboard reader stepped over `complete` and `includeRuntimeContext` without learning they exist — they are reachable now, `aria-disabled` with the value pinned, because `readOnly` names a rule for controls that take text and holds a checkbox by nothing. `SPEC.md` §2 argued the disclosure rule with "the Loader it audits adds nothing but entry ids to its messages", which the class does not support: the text under `- ` is whatever the mounted plugin rejected with, and the argument that holds is the one the row states now — the same tree already answers any client over the registry's own `agentPresets` `list` Remote, so nothing new leaves the deployment. And the published `README.md` named `docs/DSH-0.1.7-MIGRATION.md` and `#605` in backticks, two places a reader on npm cannot go (`files` ships `lib`, `cordis.patch.yml`, `compatibility.json`, `README.md`, `LICENSE`); the hygiene gate cannot see them either, because `relativeLinkTargets` reads markdown links and `src`/`href`, not prose paths. Both are absolute `blob/main` links now, the form 20 of 26 published READMEs use. The gate's blind spot is deliberately **not** closed in this card: the same prose form is live in nine other packages' READMEs, so teaching the gate about backticks would redden a check the wave does not own — it needs its own card. One repo-level piece of this card's own litter went with it: `pnpm-workspace.yaml` kept two `@deepseek-ai/dsh-agent-presets` keys (the `dsh` range and the `dsh-dev` pin) after `7821bd30` renamed the only consumer, `grep -rl dsh-agent-presets --include=package.json plugins packages tooling` is empty, this diff loses the name from `pnpm-lock.yaml`, and §1's registry sweep says the name does not exist at `rc.2` (321 DSH names queried, so it is exhaustive rather than sampled) — a dangling catalog key is an invitation to the next plugin to pin a peer on a package no install can resolve. Last, the roster screen had no way to ask again: a `waiting for <service>` line is the registry's **pending** audit result, and those rows activate by themselves once the provider mounts, so the screen held "Cannot compose" until the settings section remounted. It carries **Reload the roster** now, which is also why the fifth round's reasoning about the notice no longer applies — the path where a successful `load()` followed a refused one is reachable, so `refresh()` puts that notice down before asking and a refused retry puts a refusal back. **[rebase onto the current `rc` line, 28.09]** the head of this series sat on `0dbbd0d1` while the line moved to `1e5d35dc`, so the series was replayed over the twenty-one commits the line gained. One conflict round, and it was #291's coverage wave: `test:coverage` and `@vitest/coverage-v8` land in the same `package.json` and `pnpm-lock.yaml` hunks this card's peer rename had rewritten, and both halves are kept — the package carries the coverage script and devDependency the other projects got, beside the renamed peer and the `@testing-library/react` / `react-dom` dev tier, and `pnpm install --frozen-lockfile` calls the hand-merged lock up to date. Every number this row quotes was re-measured against the new base and none of it moved: the replay still conflicts in 20 paths (17 content, 3 modify/delete), the diff is still 43 files / +2194 / −3213 over the thirty-three commits to the last code commit, the write-half commit is still 29 files / +520 / −2425, `src/index.ts` is still 111 lines at the base and 94 after this cutover, `modeSelectionEnabled` and `standingKeyFor` still answer zero and one hit over `plugins` plus `packages`, no manifest still names `dsh-agent-presets`, and of the 26 published plugin `README.md`s, the 20 the sixth round counted still link through `blob/main` beside this card's own. What did move is the shared-preset error site above, and the commits this row and `SPEC.md` §0 name are the rebased ones | `src/host/{preset-reader.ts,service.ts,errors.ts,validation.ts,composition.ts}` (the last two comment-only, since the fifth round), `src/{index.ts,types.ts}`, `src/client/{store.ts,PersonaPage.tsx,PersonaEditor.tsx,PersonaPreview.tsx,index.tsx,locale.ts,styles.ts}`, `src/shared/prompt-sections.ts` (the registrar source and the list comparison the writer owned leave with it), `package.json` (peer+dev rename, `schemastery` leaves with the Config, `@testing-library/react` + `react-dom` join the dev tier as they did in `dsh-jev-compaction`), `README.md`, `SPEC.md`, `scripts/verify-package.mjs`, `docs/COMPATIBILITY.md` (this package's peer row), `pnpm-workspace.yaml` (the two `dsh-agent-presets` catalog keys this card's rename orphaned); `compatibility.json` needs nothing — `service:agentPresets` is the same key at `rc.2`, and the version pair is #511's wave | 43 files, +2194 / −3213 across the thirty-three commits ending at `296b8836`, the last code commit of this series (measured over everything but this document; the write-half commit alone is 29 files, +520 / −2425, and reverses only as the whole series) | `tests/{preset-reading,service,client-bundle,client-index,client-editor-markup,client-store.*,prompt-sections.*}.test.ts` — **109 tests green over all 13 files**, and `service.test.ts` is one of them for the first time: §13.3 kept that file from importing the `@Remote`-decorated host entry, so through the previous round its 11 cases had to be replayed against the compiled `lib/host/service.js` (where they passed 11/11), and #603 landed the decorator lowering in the shared vitest preset on this card's base between the two rounds. The file is 12 cases now, the fifth round's extra one pinning which positional slot the deployment's config row lands in. Lint, typecheck, `nx test`, `nx build`, `verify-package` and `prettier --check` are clean for the package, and `pnpm --filter @yadsh/dsh-preset-persona-editor check` runs end to end at exit 0 — the first whole pass this card has had. Repo-wide `pnpm -r --no-bail typecheck` exits 1 on four *other* packages (`dsh-draft-sessions`, `dsh-l10n-overrides`, `dsh-session-audit`, `dsh-sleev`), all over `packages/config/vitest/vitest.config.ts:171` — the `transform` of #603's decorator-lowering plugin, cited as `:155` until #291's coverage block shifted that file on this card's base: #603's own file, on the base, untouched by this diff. `verify-package-hygiene`, `check:files`, `deps:check`, `check-release-plans` and `test:release` are green. `client-editor-markup.test.tsx` is new and is the only test in the package that renders the client at all — it is what pins the `for`/`id` name on each reading, the one-refusal-one-sentence rule, the margin reset on every block the page draws, the two same-named sections staying two rows, and (since the third round, over the roster screen as well as the reader) that every fact the controller records is drawn by some branch of the page. The sixth round added four to that file: no control leaves the tab order and no switch moves when clicked, the header carries one line of a refused tree while the opened card carries every line and the rule that keeps the breaks, and the roster's own Reload answers a row the audit has since released. What it cannot pin is what a person sees, so §6 of `SPEC.md` now names the live pass by its three states — read cleanly, `broken`, composition refused — rather than leaving it as "not done" |
| `@yadsh/dsh-plugin-generator` (`tooling/`) | **mechanical** | generator defaults + its test literal | `tooling/generators/dsh-plugin/src/index.ts:364,365,395,428,473` **[verified]**, `tests/index.test.ts:100-101` **[verified]** | 7 | `tests/index.test.ts` (2 files pass today) |

**Wave totals.** D1-gated (card shell) packages: **exactly 12**, measured rather
than estimated — `grep -rl "settings.plugin.item" plugins/*/src` names
`dsh-doc-impact`, `dsh-documents`, `dsh-jev-compaction`, `dsh-model-safety-gate`,
`dsh-openviking-memory`, `dsh-plugin-log-ui`, `dsh-prompt-firewall`,
`dsh-qa-integrations`, `dsh-qa-surface`, `dsh-sleev`, `dsh-ui-repair`,
`dsh-web-fetch-authenticated`. That is §4.3's "~12 card components lose their
outer shell", now as a list, and it is the set the shared gate
`scripts/verify-package-hygiene.mjs:816-835` currently keys enforcement off.
**[re-measured after #520]** the same grep names **11**: `dsh-sleev` left the set
by taking D1 option 2 — it registers on `settings.plugins.tab` and kept the
shell, so the literal left its sources while the gate still guards it (the tab
counts when the shell markers are present alongside it).
Not gated by D1: `domain-experts` (already `settings.plugins.tab`),
`preset-persona-editor` (`settings.section`), `draft-sessions`, `qa-browser`,
`answer-review-gate`, `user-correction-miner`, and all six mechanical rows.
Shared plumbing to land **before** the 12: `dsh-plugin-kit`,
`dsh-plugin-scripts`, root `scripts/`, `dsh-test-kit` (≈130 lines total).
Realistic code volume: ≈900 lines across 24 packages plus the 83-file §6 wave —
consistent with §7's "roughly 100 files", now with owners.

**Issue-splitting note.** One card per row above is too coarse for the four
shared packages: `dsh-plugin-kit` should split into (a) the slot/helper swap and
(b) the shell-CSS decision follow-through, because (b) is blocked on D1 while (a)
is not. The 12 D1-gated plugin cards are otherwise independent of each other and
parallelise, provided (a) lands first. `dsh-qa-surface` is the only card that
carries a mandatory `QaChangelog.tsx` pairing (§6) and therefore the only one
whose version-plan arithmetic can silently drift.

## 12. Execution order for the `rc.2` cutover

§7 is unchanged as a sequence; three additions:

1. In §7 step 2, **add the 17 missing DSH names to both catalogs** (or a root
   override) while moving the ranges. Skipping this is what produces the three
   `TS2742` build failures and the 10 peer warnings, and those two are the
   hardest to diagnose later.
2. New step 3.5, **before** any card rewrite: settle D1 with the `rc.2` chrome
   facts (§4.3a) and, whichever way it goes, retarget
   `scripts/verify-package-hygiene.mjs:49` — otherwise the shell contract quietly
   stops being enforced the moment the slot string disappears from our sources.
   The retarget half is **done** (#510); D1 is **settled** (option 2, §10), so the
   12 card cards migrate onto `settings.plugins.tab` with the shell they have.
   The retarget half is **done** (#510); the D1 settle is **done too** — option 2,
   decided in #508 and first executed by #521.
3. §7 step 8's release half must **read the 39 existing plans first** and pair a
   new qa-surface plan with `0.14.1`/`0.15.0`, not `0.12.x` (§6).
4. New step 6 stands, none of which `nx test` covers: (a) one `plugins.row.config`
   card with a **real** read/write wired (the harness fixture ignores `form`, §4.3a
   item 1); (b) one `agent/created` listener that throws, to watch creation roll
   back; (c) one qa lockdown stand with `lockdown.permissionPreset = "auto"` (D3);
   (d) one session that triggers a dynamic tool update, then check every
   `block.type` switch for the emitted `tool-addition`/`tool-removal` (§8.4);
   (e) a focused-card check after a mouse click for the `focus.css` outranking
   (§4.3a item 3).

## 13. How these numbers were produced

Harness comparisons, all read-only against `D:/repos/dsh/deepseek-harness-source`
at `HEAD = dsh-v0.1.7-rc.2`, never a checkout or reset:

```bash
git log --oneline --no-merges dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2 | wc -l   # 224
git diff --name-only dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2 | wc -l           # 3429
git diff --quiet dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- vendor              # empty ⇒ tier frozen
git diff --name-only dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2 -- packages/typert # version/README only
```

Trial bump (this worktree, `bot/500`), each command run in full with the whole
log kept — the `tail` on the first build pass truncated the compiler output and
was repeated:

```bash
pnpm install                                    # exit 0, 20.2s
npx nx run-many -t build --output-style=stream  # exit 1: 14 failed, 4 not run
pnpm -r typecheck                               # stops at first failing project (draft-sessions)
pnpm -r --no-bail typecheck                     # 296 errors, 18 projects
npx nx run-many -t test --output-style=stream   # 14 projects ran, 113 files green; 18 blocked
```

Per-project error counts: `grep -cE "^plugins/<pkg> typecheck: .*error TS"`.
Class frequency: `grep "error TS" | grep -oE "Cannot find module '[^']*'|has no
exported member '[^']*'|Property '[^']*' does not exist on type '[^']*'|'[a-zA-Z.]+' is of type 'unknown'" | sort | uniq -c`.

Baseline control, **after** reverting the bump:

```bash
npx nx run-many -t build --skip-nx-cache        # exit 0, 0 errors
pnpm -r --no-bail typecheck                     # exit 0, 0 errors
```

Metadata wave:

```bash
grep -rl "0\.1\.5-rc\.2" --exclude-dir=node_modules --exclude-dir=lib \
     --exclude-dir=.typert-workspace --exclude-dir=workspace-data \
     --exclude=pnpm-lock.yaml . | grep -v '^\.nx/' | wc -l    # 99; minus 16 CHANGELOG.md = 83
```

Catalog keys and the `rc.2` existence sweep: parsed `catalogs.dsh` /
`catalogs.dsh-dev` in `pnpm-workspace.yaml` (45 and 48 keys) and queried
`https://registry.npmjs.org/@deepseek-ai%2f<pkg>` per name; 321 DSH names from
the harness tree were checked, so "only `dsh-agent-presets` is missing" is
exhaustive rather than sampled, and `@deepseek-ai/dsh-agent-preset-registry@0.1.5-rc.2`
was confirmed **absent** (the rename cannot precede the bump).

The two `[rc.2 fix]` claims that reverse §5 and §6 — the Auto preset's approval
value and the 39 pending version plans — were re-read directly
(`git show dsh-v0.1.7-rc.{1,2}:packages/interaction/permission-presets/src/index.ts`,
`ls .nx/version-plans/*.md | wc -l`) rather than taken on report, as were the
`AGENTS.md`-relevant ones (`ui-plugin-manager` `.card` radius re-tokening,
`focus.css`, `scripts/verify-package-hygiene.mjs:49`).

### 13.1 Repository gates that are red on `dsh-v0.1.7-rc` independently of the cutover

Anyone running `pnpm check` on this branch while doing the cutover will meet
these first, and none is caused by the version work. Re-measured on `bot/513`
after #509/#510/#511/#566 landed: two of the three original findings are fixed,
and the wave has a new, larger one.

- **Fixed:** the dangling `plugins/dsh-session-scope/src/client.ts` exemption
  (`check-file-budget.mjs:138`) was dropped by `6a9056f`, and
  `scripts/ci-verification.test.mjs` — the assertion that the budget gate belongs
  to the prepare job — was pinned by `aed74f6` and now runs 5/5 green.
- `scripts/check-file-budget.test.mjs:370` ("the workspace must be green with the
  committed list") still fails, but only **on a built tree**, and the single
  over-budget file is the generated `plugins/dsh-qa-surface/lib/client.js`:
  **238 404** lines after a clean `nx run @yadsh/dsh-qa-surface:build` when §13
  was first written, **239 025** after #513's client changes, against the
  generated-bundle runaway limit of 100 000 (unminified, ~37 chars/line). A fresh
  clone that has not built does not show it. Worth knowing before someone reads a
  red `check:files` as cutover damage. For the same reason
  `pnpm -r typecheck` and the budget gate must be measured on a **built** tree:
  the first control pass in §9.6 read 77 baseline errors purely because an earlier
  failed build's `clean` step had deleted `lib/`, which §9.6's final numbers
  therefore exclude by cache-busting first. The other budget findings named here
  are gone: `dsh-qa-surface/tests/qa-tools/qa-tools-docs.test.ts` was split to 702
  lines by `057a63e`; `packages/plugin-log/tests/plugin-logger.test.ts` at 801
  stays in the warning band.
- **New, and it blocks the whole wave, found by #513: vitest cannot load a module
  that carries a standard method decorator.** After the lockfile rebuild (`a843f19`)
  the stack is vite 8.3.1 / vitest 4.1.11 / esbuild 0.28.2, and the SSR transform
  Vite runs for `.ts` keeps ES decorators verbatim (esbuild only lowers them below
  `target: esnext`; `node_modules/.bin/esbuild <file> --target=es2022` does lower
  them, the pipeline does not). Node 26 does not parse them, so every such file
  dies at collection with a bare `SyntaxError: Invalid or unexpected token` — no
  file name, no line, and the failure is per *file*, so a package reports
  "N test files failed" with zero failed cases. Reproduced with a 25-line probe
  that imports nothing from this repository: a class with one
  `(value, context) => void` method decorator, `npx vitest run` on it, same error
  under `--pool=forks`, `--pool=threads` and `--pool=vmThreads`. It is not a
  per-package problem: 10 packages declare `@Remote(`
  (`dsh-{domain-experts,model-safety-gate,openviking-memory,plugin-log-ui,preset-persona-editor,prompt-firewall,qa-integrations,qa-surface,session-audit,web-fetch-authenticated}`),
  and every test file that imports one of their decorated modules cannot run —
  for `dsh-qa-surface` that is `tests/wiring/index-wiring.test.ts`, which fails
  identically when checked out from `HEAD` untouched. Nobody has hit it yet
  because §9.5's suites are the *un*decorated packages and the decorated ones were
  blocked behind a red build. The fix belongs to the shared preset
  (`packages/config/vitest/vitest.config.ts`), not to a plugin: the transform has
  to lower decorators (or `@Remote` has to stop being a decorator). Until then a
  cutover card must report its suite as "N-1 files green, the decorated wiring
  file cannot be collected" rather than chase it through its own source.
these first, and neither is caused by the version work:

- `pnpm check:files` exits 1 with
  `plugins/dsh-session-scope/src/client.ts: allowlisted file does not exist, drop
  it from fileBudgetAllowlist`. The entry is at
  `scripts/check-file-budget.mjs:138` and the file is absent **at `HEAD`**
  (`git cat-file -e HEAD:plugins/dsh-session-scope/src/client.ts` fails), so the
  dangling exemption was committed by whatever card removed the file. It also
  makes `scripts/check-file-budget.test.mjs:370`
  ("the workspace must be green with the committed list") fail, and through it
  `pnpm test:release`. One-line remedy, and it belongs to that refactor card, not
  to a migration card. Two further budget findings are pre-existing on the
  tracked tree: `plugins/dsh-qa-surface/tests/qa-tools/qa-tools-docs.test.ts` at
  902 lines (test budget 900) and
  `packages/plugin-log/tests/plugin-logger.test.ts` at 801 (warning band).
- `pnpm test:release` additionally fails
  `scripts/ci-verification.test.mjs:70` ("the budget gate belongs to the prepare
  job, so the size of a pull request is reported without building every
  project"), which asserts on `.github/workflows/*` — no plugin or docs file is
  involved.
- **[verified] #522 — `npx nx test <pkg>` cannot run any suite that imports a
  `@Remote`-decorated class, and this is not the migration's doing.** The
  lockfile rebuild (`a843f19`) resolved the toolchain to
  `vite@8.3.1` + `rolldown@1.2.11`, whose `oxc` transform is the TS transformer
  now; oxc lowers only *legacy* decorators (`DecoratorOptions.legacy`,
  `rolldown/dist/shared/binding-*.d.mts:840-860`) and emits standard TS
  decorators verbatim for any target, while node 24's V8 (13.6) does not parse
  them — every such module fails at load with
  `SyntaxError: Invalid or unexpected token` on the `@…` line, with no frame.
  `packages/config/tsconfig/*.json` sets no `experimentalDecorators`, so the
  typert `@Remote`/`@Command` pattern (a `ClassMethodDecoratorContext` decorator,
  `@deepseek-ai/dsh-typert-protocol/lib/types/index.d.ts:82`) is exactly the
  affected shape. Measured on `card-522` at `bot/522` before any edit:
  `tests/integration.test.ts` of `dsh-prompt-firewall` fails the same way from
  `HEAD`'s sources, and a three-line class with a local standard decorator
  reproduces it. Workaround used by #522 to verify its own migration: emit with
  `tsc` first (which lowers standard decorators correctly, and is what
  `pnpm build` already does) and run vitest over the emitted
  `.scratch-build/tests/*.test.js` — 8 files / 36 tests green that way. The real
  fix is toolchain-level, not per package: either the shared
  `@yadsh/dsh-config/vitest` preset transforms TS through `tsc`/esbuild, or the
  runtime is raised to a node whose V8 parses decorators. It belongs to the
  lane, not to a cutover card — 12 of the 24 rows of §11 import a decorated
  class in their own tests, so every one of them will meet this.
- **Any test file that imports a `@Remote`-decorated class cannot load**, and this
  is not the version work: it is `a843f19` ("пересобрать lockfile с нуля на rc.2"),
  which moved `vite` `7.3.6 → 8.3.1`. Vite 8 replaced esbuild's transform with
  oxc's, and **oxc lowers standard decorators at no target** — probed directly on
  `rolldown@1.2.11`'s `transform`: `{lang:'ts'}`, `{target:'es2022'}` and
  `{target:'es2015'}` all emit `@Remote("tail") tail(…)` unchanged, which Node
  then rejects with `SyntaxError: Invalid or unexpected token`. Only
  `{decorator:{legacy:true}}` lowers, and `Remote`'s first overload takes a
  `ClassMethodDecoratorContext`, so legacy output is the wrong semantics.
  esbuild *did* lower it (`esbuild@0.28.2` with `target: es2022` emits
  `__esDecorate` helpers), so every one of these suites passed right up to that
  commit. `tsc` still lowers, which is why `build`, `typecheck` and the shipped
  bundle are unaffected — the gap is only under `vitest`.
  Census: `@Remote` appears in ten `plugins/*/src` files, but
  `dsh-plugin-log-ui/tests/integration.test.ts` is the **only** committed test
  that imports one, so this first surfaced on card #521. It is verified there by a
  scratch `vitest` config that pre-transpiles decorated sources with the root
  `typescript@5.9.3` (7/7 files, 41 tests) — the committed tree still fails, and
  the fix belongs in `packages/config/vitest/vitest.config.ts`, where one pre
  plugin serves all ten packages. Do not read this as #521 damage, and do not
  "fix" it by moving a test off `src/`.

`plugins/dsh-qa-surface/lib/client.js` also trips the generated-bundle runaway
limit at **238 404 lines** after a clean `nx run @yadsh/dsh-qa-surface:build`
(unminified, ~37 chars/line, so a fresh clone that has not built does not show
it). Worth knowing before someone reads a red `check:files` as cutover damage.
For the same reason, `pnpm -r typecheck` and the budget gate must be measured on
a **built** tree: the first control pass in §9.6 read 77 baseline errors purely
because an earlier failed build's `clean` step had deleted `lib/`, which §9.6's
final numbers therefore exclude by cache-busting first.

### 13.2 The `dsh-session-scope` reader census behind §11

Counted from inside the plugin directory, because both `git grep` and `git ls-files`
resolve a bare pathspec against the **current** directory — run from the repo root,
`git grep … -- tests` searches a `tests/` that only exists per-package, and returns
nothing without saying so. Filesystem `grep` has no such trap and is what these
numbers came from:

```bash
cd plugins/dsh-session-scope
grep -rcn "snapshotEvents" src            | awk -F: '{s+=$2} END {print "src:", s}'     # 10
grep -rcn "snapshotEvents" tests          | awk -F: '{s+=$2} END {print "tests:", s}'   # 18
grep -rn  "snapshotEvents" src | sort     # the 10, per file:
#   host-api.ts:24 (declaration)  host-api.ts:57 (call)
#   index.ts:141, 497 (calls)
#   scope-delegation.ts:22 (declaration)  :49, :57, :84 (calls)
#   scope-fs.ts:121, 140 (calls — length-only, the §5 `seq` slice)
```

so `src` is 8 calls over 2 declared members and `tests` holds 18 more (12 fake
sessions and 6 calls; the fakes are what any migration would have to grow a member
for). The 10 `src` line refs in §11's row were re-verified against the tree and none
had moved.

### 13.3 Vitest cannot load any module that carries a decorator (since `a843f19`)

Measured while landing #524, and it is not cutover damage: the lockfile rebuild
`a843f19` ("пересобрать lockfile с нуля") moved **vite `7.3.6` → `8.3.1`** with
vitest unchanged at `4.1.11`, and a suite that imports a source file containing a
TypeScript standard decorator now fails at load with

```
SyntaxError: Invalid or unexpected token
  <pkg>/src/index.ts:144
    @(0,__vite_ssr_import_1__.Remote)("status") async status() {
```

— the transform pipeline leaves the decorator in the emitted module, and no Node
release parses decorator syntax. Minimal repro, inside any package:

```ts
// src/zz/dec-probe.ts
function dec(_target: unknown, _ctx: unknown): void {}
export class Probe {
  @dec method(): string { return "ok"; }
}
```
imported by `await import()` in one test: same `SyntaxError`. `@Remote` from
`@deepseek-ai/dsh-typert-protocol` is not special, and neither package is at
fault.

Six packages import their decorated host entry from a test, so all six will read
this as "my suite is red": `dsh-domain-experts`, `dsh-openviking-memory`,
`dsh-plugin-log-ui`, `dsh-prompt-firewall`, `dsh-qa-integrations`,
`dsh-web-fetch-authenticated`. None of them was visible before, because each also
fails §9.3/§9.4 and so its suite never ran.

It is not fixable per package. vite's `OxcOptions` omits `tsconfig` from the
transform options, and passing `target` explicitly changes nothing — `es2021`,
`es2022` and `esnext` all reproduce the same failure (measured with a scratch
`vitest.config.ts` in `dsh-web-fetch-authenticated`, since removed). The fix
belongs to the shared tooling (`packages/config/vitest/vitest.config.ts`, or the
vite major it was pulled in under), not to a migration card.

**Landed by #603.** `packages/config/vitest/vitest.config.ts` now carries a
`dsh:lower-standard-decorators` pre plugin: it parses each TypeScript module, and
where the AST really declares a decorator it emits the module through the
`typescript` the preset resolves, before Vite's oxc transform sees it. That
compiler is not the one a plugin build runs, and the difference is worth naming:
the preset takes `typescript` from `catalog:tooling` (5.9.3), while `pnpm build`
compiles a plugin with `tsc` from `catalog:plugin-tooling` (7.0.2). Both lower a
decorated method to the same `__esDecorate` / `__runInitializers` prelude and the
same class wrapper — diffed byte for byte on the fixture under
`packages/config/tests/` — so what is left between them is module emit, which the
preset overrides on purpose (`transpileModule` cannot read `package.json`, so
`node.json`'s `NodeNext` would emit CommonJS where `ESNext` keeps the ESM). The
lowering takes `.ts` files only: a decorated `.tsx` would reach Vite as JSX
labelled `moduleType: "js"`, and no `.tsx` in the repository declares a
decorator.

Nothing per package had to change — except `dsh-qa-integrations`, the one project
whose `vitest.config.ts` called `defineConfig` directly instead of consuming the
preset, which now calls `definePluginVitestConfig`. The preset carries its own
suite now (`packages/config/tests/lower-standard-decorators.test.ts`, run by
`nx run-many -t test` as `@yadsh/dsh-config`): it imports a decorated fixture
through the preset, so a regression prints the named failure this card spent its
first pass hunting for — with the plugin removed for a control run, that suite
fails with `SyntaxError: Invalid or unexpected token` and no frame. Measured on
`bot/603` over `792a6cb9`: `nx run-many -t test` reports no `SyntaxError` in any
project, and the six packages named above collect their suites
(`dsh-qa-integrations` 112 files green). Do not read a decorator
failure as a new regression, and do not work around it in a package —
`dsh-draft-sessions`'s decorator-free `@Remote` application
(`src/index.ts:107`) is now unnecessary.

