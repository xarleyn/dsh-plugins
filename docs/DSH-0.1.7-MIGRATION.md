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
| `dsh-qa-integrations` | 76 | mostly cascade from unbuilt `@yadsh/dsh-qa-surface/client/*`; real work is the card + `SettingsScope` |
| `dsh-qa-surface` | 38 | card + `installSection` + own `qaSurfacePanels` merge |
| `dsh-jev-compaction` | 27 | card, `installSection`, LLM message shapes |
| `dsh-qa-browser` | 24 | card surface, client slots |
| `dsh-openviking-memory` | 22 | card surface, `settings` unknown, session writes |
| `dsh-model-safety-gate` | 14 | card + `installSection` in `src/service.ts` |
| `dsh-plugin-log-ui` | 13 | card + `installSection` |
| `dsh-draft-sessions` | 13 | client conversation/controller types |
| `dsh-sleev` | 12 | card + `installSection` |
| `dsh-prompt-firewall` | 12 | card + `installSection` |
| `dsh-documents` | 11 (+build) | card + `installSection` |
| `dsh-web-fetch-authenticated` | 9 | card + `installSection` |
| `dsh-ui-repair` | 9 | card + `installSection` |
| `dsh-user-correction-miner` | 3 | LLM `tool-result` block removal |
| `dsh-domain-experts` | 2 | `installSection` |
| `dsh-preset-persona-editor` | 1 | `AgentPresetRegistry` lost `authorable`/`copy` |
| `dsh-doc-impact` | 1 | card surface |
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

### 4.3 The card-shell contract is the open decision

**This is the one thing that needs a maintainer call, not an edit.** Our cards
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
   survives, and is what `AGENTS.md` already prescribes for feature-owned
   pages). Smallest diff and preserves every gate verbatim; costs us the
   first-party Plugins-page integration and puts plugin config under Settings.

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
  `src/types.ts:22`) — so `dsh-preset-persona-editor` loses one more face
  (`src/index.ts:561` reads `standingKeyFor`, which no longer exists either).
  **[inferred]** nothing under `packages/preset` touches the filesystem at `rc.2`,
  so durable authoring has no Host path left: either drop copy/authorable and
  treat presets as read-only plus `select`, or call
  `ctx.agentPresets.register(definition)` in-process, which is memory-only and
  returns a disposer (`src/index.ts:80`). This is now a feature decision for the
  owner, not a migration detail — see §10.
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
  agrees: no error mentions these three. This stays deferred debt
  (`dsh-session-scope` alone makes 8 `snapshotEvents()` calls).
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
but rewriting a published entry is the CHANGELOG rule), the two
`@deepseek-ai/dsh-agent-presets` catalog keys (§1: that name does not exist at
`0.1.7-rc.2`), and the measurements in this document.

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
| `pnpm-workspace.yaml` | 1 |
| **total** | **99** |

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
- Pre-existing bug to fold in: `plugins/dsh-sleev/scripts/smoke-packed-dsh.mjs:19`
  defaults to a stale `"0.1.1-rc.2"` instead of `testedReleases.at(-1)` like the
  sibling smoke scripts.

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
| `dsh-qa-integrations` | 76 | 77 | +1 | card + `SettingsScope` + unbuilt qa-surface client cascade |
| `dsh-qa-surface` | 38 | 45 | **+7** | card, `SettingsScopeBinder`, own `qaSurfacePanels`, **new** session-state reads |
| `dsh-jev-compaction` | 27 | 27 | 0 | card, `installSection`, LLM message shapes |
| `dsh-qa-browser` | 24 | 24 | 0 | card surface, client slots, **typert `schema`** ×8 |
| `dsh-openviking-memory` | 22 | 22 | 0 | card surface, `settings` unknown, session writes |
| `dsh-model-safety-gate` | 14 | 14 | 0 | card, `installSection`, **`MemorySettings` fake** |
| `dsh-plugin-log-ui` | 13 | 13 | 0 | card, `installSection`, `MemorySettings` fake |
| `dsh-draft-sessions` | 13 | 13 | 0 | client conversation/controller types, **`ISessions.open`**, typert `schema` |
| `dsh-sleev` | 12 | 12 | 0 | card, `installSection` |
| `dsh-prompt-firewall` | 12 | 12 | 0 | card, `installSection`, `MemorySettings` fake |
| `dsh-documents` | 11 | 11 | 0 | card, `installSection`, `'snapshot' is unknown` ×6 |
| `dsh-web-fetch-authenticated` | 9 | 9 | 0 | card, `installSection` |
| `dsh-ui-repair` | 9 | 9 | 0 | card, `installSection` |
| `dsh-user-correction-miner` | 3 | 3 | 0 | LLM `tool-result` block removal |
| `dsh-domain-experts` | 2 | 2 | 0 | `installSection` |
| `dsh-preset-persona-editor` | 1 | 1 | 0 | `AgentPresetRegistry` missing `authorable`, `copy` |
| `dsh-doc-impact` | 1 | 1 | 0 | card surface |
| `dsh-answer-review-gate` | 1 | 1 | 0 | message source kind `'plugin'` |

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
   `dsh-model-safety-gate/tests/integration/settings.test.ts:19,21,26,30`,
   `dsh-plugin-log-ui/tests/integration.test.ts:14,21,25`,
   `dsh-prompt-firewall/tests/settings.test.ts:14,21,25`:
   `TS2610 'writable' is defined as an accessor in class 'SettingsForms', but is
   overridden here in 'MemorySettings' as an instance property` and
   `TS4113 This member cannot have an 'override' modifier because it is not
   declared in the base class 'SettingsForms'`. Each of the three plugins declares
   its own fake, so the fix is 3 files — or one shared fake promoted into
   `@yadsh/dsh-test-kit`, which is the better call and is why `test-kit` appears
   in §11 despite having no error of its own.
3. **`rc.2`-new session-state and preset reads inside `dsh-qa-surface`** — this is
   where the `+7` lives: `src/client/QaSessionController.ts:1644`
   `subagentsByParent` gone from `SessionListState`;
   `src/client/project-session-state.ts:75` `queue` gone from `SessionSnapshot`;
   `src/index.ts:561` `standingKeyFor` gone from `AgentPresetRegistry`;
   `src/client/QaTranscriptAdapter.ts:476` `node.provenance` → `node.producer`.
   **[verified]** these are the only genuinely *new* compile errors attributable
   to `rc.2` itself in the whole repository.

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

**D1 — the settings card shell (§4.3, §4.3a) — still open, and now costed.**
Option 1 (accept host chrome): delete `CardShell` from the `plugins.row.config`
path, rewrite `AGENTS.md`'s canonical shell CSS block and the shared gate
`packages/plugin-scripts/verify-plugin-card-contract.mjs:4-15,39,44-45`, and lose
~12 cards' outer shell. Option 2 (keep our shell on `settings.plugins.tab`):
smallest diff, every gate survives verbatim, but as of `rc.2` our 12px/1px/2px
shell sits next to host cards that are 20px/0.5px/`--dsw-focus-ring-*`, and the
new `focus.css` modality rule can silence our focus ring (§4.3a item 3).
**New fact for either branch:** `scripts/verify-package-hygiene.mjs:49,816-835`
keys the *entire* card-contract enforcement off a source file containing the
literal `settings.plugin.item`; once plugins register `plugins.row.config`, that
gate stops firing and the shell contract becomes unenforced unless the constant is
retargeted. **[verified]** line 49 and the block at 816-835.

**D2 — preset authoring (`dsh-preset-persona-editor`) — newly open.** §8.6:
the copy-to-writable-root capability does not exist at `rc.2`, and neither does
`modeSelectionEnabled` or `standingKeyFor`. Owner must choose between shipping the
editor as read-only + `select`, or writing preset YAML/registration through a
plugin-owned path (the plugin already has its own file IO in
`src/host/preset-reader.ts`) and owning durability plus the `agent-preset`
compatibility implications. This is a feature decision, not a migration step.

**D3 — the `auto` permission preset vs qa lockdown (§5, §8.5) — newly open.**
`dsh-qa-surface` hard-pins `approvalPolicy: "never"`, refuses any other value
(`lockdown.ts:76-79`), and throws at attestation on mismatch
(`secure-session.ts:841-848`). `rc.2` resolves `auto` to `ask`. Either the pin
accepts `ask` for `auto`, or lockdown documents that `auto` is not a valid
lockdown preset and rejects it earlier with a clear error. Needs one stand to
confirm the failure mode first (§12 step 6).

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
| `@yadsh/dsh-plugin-kit` | **decision → do first** | `SETTINGS_PLUGIN_ITEM_SLOT` → `plugins.row.config` helper; `ConfigForm`-shaped binding (`ctx.configForms.get<T>(ns)`); `card-shell.tsx`/`chevron.tsx`/`plugin-card-css.ts` die only under D1 option 1 | `src/client/register-settings-card.tsx:56,93,116` **[verified]**, `src/client/settings-store.ts:3` (survives — structural over `subscribe`/`getSnapshot`), `src/client/card-shell.tsx:34-57`, `src/client/chevron.tsx:13`, `src/client/index.ts:17,19-21` | 60 | none of its own (4 files pass today); exercised by every plugin client test |
| `@yadsh/dsh-plugin-scripts` | **decision** | canonical shell CSS + chevron assertions; `deepEqual` capability | `verify-plugin-card-contract.mjs:4-15,39,44-45` **[verified]**, `run-verify-package.mjs:45,169-174`, `run-verify-package.test.mjs:58-59` (version literal) | 25 | `run-verify-package.test.mjs` |
| repo root `scripts/` | **decision** | `SETTINGS_CARD_SLOT` constant must follow D1 or the gate goes blind (§4.3a) | `verify-package-hygiene.mjs:49,816-835` **[verified]**; `package-hygiene.test.mjs:41-42`; `check-dependencies.test.mjs:67,69,131` | 15 | `package-hygiene.test.mjs` |
| `@yadsh/dsh-test-kit` | code | host **one** `MemorySettings` conforming to `SettingsForms` (accessor `writable`, no stray `override`) so 3 plugins share it — no error of its own today | new/changed fake in `packages/test-kit/src/**`; current copies at `dsh-model-safety-gate/tests/integration/settings.test.ts:19-30`, `dsh-plugin-log-ui/tests/integration.test.ts:14-25`, `dsh-prompt-firewall/tests/settings.test.ts:14-25` **[verified]** | 30 | `dsh-test-kit` 3 files pass today |
| `dsh-qa-surface` | **decision + code, biggest** | volatile `Config`; card path; `SettingsScopeBinder` gone; **4 new `rc.2` reads**; provenance→producer; `dsh-agent-presets` rename; own `qaSurfacePanels` merge | `src/index.ts:487,561`; `src/client/index.tsx:11,528,834-859`; `src/client/QaConfigController.ts:1,35`; `src/client/settings/card.tsx:13,69,73,77,242`; `src/client/QaTranscriptAdapter.ts:476,248`; `src/client/turn-sources.ts:82`; `src/client/QaSessionController.ts:1644`; `src/client/project-session-state.ts:75`; `src/client/panels/contract.ts:70`; `src/access/{capability-catalog.ts:33,207,218,model.ts:533}`; `src/qa-tools/lifecycle.ts:40` already `agent/created` ✔; deprecated reads `prompt-notes.ts:375`, `secure-session.ts:547`, `admin/session-log.ts:130,231`, `provenance/host-store.ts:83,236`, `qa-tools/durable-marker.ts:97,101`; `compatibility.json:4-5,12`; `scripts/verify-package.mjs:501-517`; `package.json:61-70`; `QaChangelog.tsx` (§6) | 130 | ≈14 files: `tests/wiring/index-wiring.test.ts:81-82`, `tests/config/config-controller.test.ts`, `tests/provenance/*`, `tests/transcript/*`, `tests/qa-tools/*`, `tests/admin/*` |
| `dsh-qa-integrations` | decision + code | `SettingsScope`→`ConfigForm` type swaps (77 errors, mostly cascade); card | `src/index.ts:409,1523`; `src/client/index.tsx:3,44-53,75,93-98,123-126`; `src/client/operator-card.tsx:5,16,57,60,64,141`; `src/client/card.tsx:5,46`; `compatibility.json:4-5,7`; `scripts/verify-package.mjs:215-216` | 120 | `tests/client-registration.test.ts:138,161`, `tests/client-bundle.test.tsx`, `tests/card.test.tsx`, `tests/plugin.test.ts` |
| `dsh-jev-compaction` | decision + code | settings install + card; **largest non-settings cluster**; `TS2742` at `config.ts:854` | `src/settings/install.ts:21,66`; `src/client/index.tsx:32,42-65`; `src/client/card.tsx:15,48,51,55,164`; `src/dsh/surface.ts:11,16,75,82,130,137,142,145`; `src/planner/collect.ts:23,50,72,158,200-202`; `src/jev/state.ts:73,101`; `src/mutation/apply.ts:63`; `src/result-shaping/budget.ts:28`; `compatibility.json:4-5,7`; **`scripts/verify-package.mjs:56` deepEqual — must edit** | 90 | `tests/client/{client-bundle,registration,settings-card}.test.tsx`, `tests/unit/settings.test.ts`, `tests/integration/{post-execute.test.ts:241,surface,engine,service,persistence}.test.ts`, `tests/eval/evaluation.test.ts` |
| `dsh-openviking-memory` | decision + code, riskiest | volatile Config; card; **`agent/session-start` → `agent/created`, handler must not throw**; block taxonomy at runtime | `src/index.ts:194` **[verified]**; `src/settings.ts:26,67`; `src/client/index.tsx:46,82-97`; `src/client/card.tsx:14,38,41,45,150`; `src/runtime.ts:793,807-810,827`; `src/capture.ts:93,143`; `src/openviking/capture-utils.ts:151,327,350,457`; `compatibility.json:4-5,9,16`; **`scripts/verify-package.mjs:63` deepEqual**, `:64,73,190`; `package.json:49-52`; `scripts/smoke-packed-dsh.mjs` stale default | 85 | **`tests/bundle.test.ts:173-176` hard assert**, `tests/injection.test.ts:78,196,259,304`, `tests/qa-scoping.test.ts:72`, `tests/runtime-context.test.ts:215-258`, `tests/runtime-drain.test.ts:134`, `tests/runtime-lifecycle.test.ts:142,231`, `tests/settings-install.test.ts:83,166,228,266`, `tests/profile-space.test.ts:89`, `tests/helpers/harness.ts:312,337-338,380` |
| `dsh-model-safety-gate` | decision + code | volatile Config; card; shared fake; own `"tool-result"` **label** channel is ours, keep it | `src/service.ts:278,624`; `src/client/index.tsx:43,52,60`; `src/client/card.tsx:12,54,58,62,181`; `src/client/sections.tsx:196`; `src/guards/tool-results.ts:83`; `src/pipeline.ts:282`; `src/types.ts:96`; `src/classifier/prompt.ts:50`; `src/audit/metrics.ts:15,38,40`; `compatibility.json:4-5`; `scripts/verify-client-bundle.mjs:85` | 55 | `tests/integration/settings.test.ts:8,17,52,72,103`, `tests/client-card.test.tsx`, `tests/client-index.test.ts`, `tests/unit/pipeline.test.ts` |
| `dsh-preset-persona-editor` | **decision (D2)** | registry rename; roster face has **no** replacement; `standingKeyFor` gone; `modeSelectionEnabled` gone | `src/host/preset-reader.ts:67,297`; `src/host/service.ts:114` (**error site: `TS2739 … missing: authorable, copy`**); `src/client/{store.ts:84,96,255,PersonaPage.tsx:71-94,PersonaEditor.tsx:509}`; `src/client/index.tsx` injects `settings.section` → survives, **no D1 dependency**; `compatibility.json`; `package.json:102,114` | 30 | `tests/preset-files-reading.test.ts:58`, `tests/service.test.ts:62,134`, `tests/helpers/preset-roster.ts:38`, `tests/client-bundle.test.ts:68-69`, `tests/client-index.test.ts:95` |
| `dsh-documents` | decision + code | volatile Config; card; `'snapshot' is unknown` ×6; workspace `list` now follows symlinks | `src/index.ts:165`; `src/client/index.tsx:29,36-41`; `src/client/card.tsx:16,78,81,91,92,110,111,138,142,149`; `compatibility.json:7`; `package.json:120-124`; `scripts/verify-client-bundle.mjs:48,55` | 45 | `tests/documents-card.test.tsx` |
| `dsh-sleev` | decision + code | volatile Config; card; **direct** `ctx.slots.inject("settings.plugin.item")`; **fold the pre-existing smoke-script bug** | `src/index.ts:68`; `src/client/index.tsx:13,142,210,322,338,340`; `src/client/settings-controller.ts:5,95`; `compatibility.json:4-5,7`; `scripts/verify-package.mjs:39,41`; **`scripts/smoke-packed-dsh.mjs:19` hard-codes `"0.1.1-rc.2"`**; `scripts/smoke-neuraldeep.ts:37,225,236,241` | 45 | `tests/settings-controller.test.ts`, `tests/config.test.ts` |
| `dsh-plugin-log-ui` | decision + code | volatile Config; card; shared fake; typert-driven panel | `src/index.ts:70`; `src/client/index.tsx:4,67,71,166,268,299,329`; `compatibility.json:4-5,7`; `scripts/verify-client-bundle.mjs:43,47` | 40 | `tests/client-panel.test.ts:232`, `tests/client-settings-store.test.ts`, `tests/integration.test.ts:2,12,14,21,25,76,125` |
| `dsh-prompt-firewall` | decision + code | volatile Config; card; shared fake | `src/index.ts:90`; `src/client/index.tsx:4,62,67,153,193,202,216`; `compatibility.json:4-5,7`; `scripts/verify-client-bundle.mjs:34` | 40 | `tests/settings.test.ts:2,12,14,21,25,45`, `tests/client-index.test.ts`, `tests/client-settings-store.test.ts` |
| `dsh-ui-repair` | decision + code | volatile Config; card; **a DOM selector that is functional, not cosmetic**; the join key this plugin already exemplifies §4.2 | `src/index.ts:28`; `src/client/index.ts:5,27,41,67`; `src/client/card.tsx:1,25,29,148,400`; **`src/client/dom.ts:11`** `[data-slot='settings.plugin.item'] > *` **[verified]**; `package.json:39-41`; `cordis.patch.yml:4` row id → `@yadsh/dsh-ui-repair#dsh-ui-repair`; `scripts/verify-client-bundle.mjs:41` | 40 | `tests/client-index.test.ts:66,71`, `tests/dom.test.ts:46`, `tests/client-bundle.test.ts`, `tests/build-wiring.test.ts` |
| `dsh-web-fetch-authenticated` | decision + code | volatile Config; card; web tool API untouched (§8.5) so no tool work | `src/index.ts:138`; `src/client/index.tsx:15,17,61,153,185,198,210`; `src/client/sections.tsx:12,51`; `compatibility.json:4-5,7`; `scripts/verify-client-bundle.mjs:52` | 45 | `tests/client-content-types.test.ts`, `tests/client-format.test.ts` |
| `dsh-draft-sessions` | code (no settings surface) | client conversation/controller types; **`ISessions.open`/`.clear`, `SessionListState.current`**; typert `schema` | `src/client/composer.ts:32,68,80,118`; `src/client/index.ts:59`; `src/client/shortcut.ts:54,60,125`; `src/client/workspace-contribution.ts:163,215`; `src/remote.ts:80,84`; `compatibility.json:4-5`; `package.json` client deps | 25 | `tests/remote.test.ts:30`, `tests/{client-index,types,sidebar,composer}.test.ts` |
| `dsh-qa-browser` | code (no settings surface) | client slot/renderer typing; typert `schema` ×8 | `src/client/*` `PropsRuntime<…>` (`:60`); `src/remote*` schema sites; `compatibility.json:4-5`; `package.json:50,52,55` | 25 | `tests/{browser-panel-render,browser-panel-interactions,panel-view,client-*}.test.tsx` |
| `dsh-answer-review-gate` | code | `'plugin'` source kind (**not a role**, §5); `form: "notice"` vocabulary; deprecated reads | `src/index.ts:146` **[verified error site]** (map said `:128`); `src/candidate.ts:26,72,115`; `src/waiver.ts:30,103,202,209`; `compatibility.json:4-5`; `scripts/verify-package.mjs:31` | 20 | `tests/{candidate:24-25,gate:92-93,225-226,280-281,gate-budget-boundaries:170-171,326-333,integration:115-116,208,waiver-command:44}.test.ts` |
| `dsh-user-correction-miner` | code | `tool-result` block gone; `SessionHeader` fixture; new `SESSION_QUERY_CORRUPT_SESSION` | `src/mining/message-text.ts:5` **[verified]**; `src/mining/context-extractor.ts:39,92`; `src/mining/engine.ts:127`; `src/types.ts:34`; `src/storage.ts:44` (own enum — keep); `tests/fixtures/sessions.ts:7-8,19,32,84`; `compatibility.json` | 25 | `tests/{context-extractor,engine,storage,sessions}.test.ts` |
| `dsh-domain-experts` | code, **no card decision** | already on `settings.plugins.tab`, which survives → D1 does not gate it | `src/index.ts:231` installSection → volatile Config; `compatibility.json:13` `"settings.installSection"` | 20 | `tests/config.test.ts`, `tests/client-page-*.test.tsx` |
| `dsh-doc-impact` | decision + code | card surface (1 error); deprecated session reads | `src/client/index.ts:36,50-55`; `src/client/card.ts:4,57,67`; `src/dsh/lifecycle.ts:73` `kind:"plugin"`; `src/dsh/{commands.ts:14,67,tools.ts:47}`; `compatibility.json:4-5`; `scripts/verify-client-bundle.mjs:44,61` | 35 | `tests/client-bundle.test.ts:152,154`, `tests/e2e.test.ts:85` |
| `dsh-session-scope` | **mechanical** + debt | 8 `snapshotEvents()` calls, alive and still merely deprecated (§5) | `src/{host-api.ts:24,57,index.ts:141,497,scope-delegation.ts:22,49,57,84,scope-fs.ts:121,140}`; `compatibility.json:4-5`; `scripts/verify-compatibility.mjs:17` regex accepts `0.1.7-rc.2` ✔ | 4 now (≈40 if the debt is taken) | `tests/{host-api,scope-delegation,scope-fs,scope-remote,tool-guard-*}.test.ts` (17 pass today) |
| `dsh-tool-offload` | **mechanical** | shell/sandbox untouched §8.5; one fixture source kind | `compatibility.json:4-5`; `tests/unit/parent-context.test.ts:29` `kind:"plugin"` | 5 | `tests/unit/parent-context.test.ts` (14 files pass today) |
| `dsh-kv-persist` | **mechanical** | metadata only | `compatibility.json:4-5` | 2 | 11 test files pass today, unchanged |
| `dsh-cas-results`, `dsh-git-readonly`, `dsh-lightrag`, `dsh-l10n-overrides` | **mechanical** | metadata only | `compatibility.json:4-5` each | 2 each | 15 / 12 / 9 / 17 files pass today, unchanged |
| `dsh-session-audit` | **mechanical** | client slots all survive (§8.2); watch `ApprovalRequestEvent.displayReason` — must not be persisted | `compatibility.json:4-5`; README/SPEC lines | 4 | 8 test files pass today, unchanged |
| `@yadsh/dsh-audit-core`, `@yadsh/dsh-audit-ui`, `@yadsh/dsh-plugin-log`, `@yadsh/dsh-config` | **nothing** | typert unchanged §8.5; grep for every migrating identifier returns zero (`audit-core/src/types.ts:113` `provenance` is its own schema field) | — | 0 | 5 / 3 / 1 / — pass today |
| `@yadsh/dsh-plugin-generator` (`tooling/`) | **mechanical** | generator defaults + its test literal | `tooling/generators/dsh-plugin/src/index.ts:364,365,395,428,473` **[verified]**, `tests/index.test.ts:100-101` **[verified]** | 7 | `tests/index.test.ts` (2 files pass today) |

**Wave totals.** D1-gated (card shell) packages: **exactly 12**, measured rather
than estimated — `grep -rl "settings.plugin.item" plugins/*/src` names
`dsh-doc-impact`, `dsh-documents`, `dsh-jev-compaction`, `dsh-model-safety-gate`,
`dsh-openviking-memory`, `dsh-plugin-log-ui`, `dsh-prompt-firewall`,
`dsh-qa-integrations`, `dsh-qa-surface`, `dsh-sleev`, `dsh-ui-repair`,
`dsh-web-fetch-authenticated`. That is §4.3's "~12 card components lose their
outer shell", now as a list, and it is the set the shared gate
`scripts/verify-package-hygiene.mjs:816-835` currently keys enforcement off.
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

### 13.1 Two repository gates are red on `dsh-v0.1.7-rc` independently of any of the above

Anyone running `pnpm check` on this branch while doing the cutover will meet
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

`plugins/dsh-qa-surface/lib/client.js` also trips the generated-bundle runaway
limit at **238 404 lines** after a clean `nx run @yadsh/dsh-qa-surface:build`
(unminified, ~37 chars/line, so a fresh clone that has not built does not show
it). Worth knowing before someone reads a red `check:files` as cutover damage.
For the same reason, `pnpm -r typecheck` and the budget gate must be measured on
a **built** tree: the first control pass in §9.6 read 77 baseline errors purely
because an earlier failed build's `clean` step had deleted `lib/`, which §9.6's
final numbers therefore exclude by cache-busting first.
