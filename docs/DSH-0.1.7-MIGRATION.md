# DSH 0.1.7-rc.1 migration map

Status: **investigation complete, cutover not performed.** The repository stays on
the `0.1.5-rc.2` baseline (see [COMPATIBILITY.md](COMPATIBILITY.md)). This
document records what changes in `dsh-v0.1.7-rc.1`, what breaks here, and the
exact recipe for each breakage, so the implementation pass does not have to
re-derive any of it.

Method: five parallel investigations over the harness sources at the
`dsh-v0.1.7-rc.1` tag (a local checkout of the DeepSeek Harness repository), then
an actual trial bump of this repository's catalogs to the target versions with a
real `pnpm install`, `nx build` and `pnpm -r typecheck`. Every claim below is
tagged:

- **[verified]** — read off the installed `0.1.7-rc.1` type declarations, or
  produced by the compiler during the trial bump.
- **[source]** — read off the harness source at the tag, not exercised at runtime.
- **[unverified]** — needs a running host to settle.

## 1. Pre-flight (all green)

- **[verified]** `0.1.7-rc.1` is published to the registry
  (`npm view @deepseek-ai/dsh versions` ends `0.1.7-alpha.1, 0.1.7-alpha.2,
  0.1.7-rc.1`). This was the Phase 0 blocker in the earlier plan: without it no
  manifest version may move, because `catalog:dsh-dev` and the
  `smoke-packed-dsh.mjs` scripts install from the registry.
- **[verified]** Bumping both catalogs and running `pnpm install` resolves and
  links cleanly; `@deepseek-ai/dsh-settings@0.1.7-rc.1` and
  `@deepseek-ai/cordis@4.0.4` land in the isolated store.
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

### Framework tier moves independently

The DSH family bumps in lockstep (`0.1.5-rc.2` → `0.1.7-rc.1`, 261 packages), but
the framework tier does **not** — it moves on its own schedule and must be
retargeted separately in both catalogs:

| Package | current | at 0.1.7-rc.1 |
| --- | --- | --- |
| `@deepseek-ai/cordis` | `4.0.2` | `4.0.4` |
| `@deepseek-ai/schemastery` | `3.18.2` | `3.18.4` |
| `@deepseek-ai/cosmokit` (transitive) | `1.8.3` | `1.8.5` |

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

## 3. Measured breakage from the trial bump

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

## 5. Non-settings breakages

All **[verified]** by the compiler during the trial bump:

- **Message roles.** `'plugin'` is no longer a message role
  (`'user' | 'model' | 'tool' | 'system-prompt'`). Hits
  `dsh-answer-review-gate/src/index.ts:128` and role-tagged fixtures in
  `dsh-qa-*`.
- **`tool-result` blocks are gone.** `ToolResultBlock` was replaced by
  `ToolAdditionBlock`/`ToolRemovalBlock`, so `ContentBlock` no longer has
  `content`, and `ToolResultMessage` no longer overlaps the old literal shapes.
  This is the largest non-settings cluster: `dsh-jev-compaction`
  (`src/dsh/surface.ts:75,82,142`, `src/planner/collect.ts:72` + 4 test files),
  `dsh-user-correction-miner` (`src/mining/message-text.ts:5`),
  `dsh-openviking-memory`. Several are `as`-casts that now need an explicit
  `unknown` hop or a real narrow.
- **`PostToolDecision`** literal shape changed
  (`dsh-jev-compaction/tests/integration/post-execute.test.ts:241`); additively
  gained `{ kind: 'cancel' }` and `deny.info?`.
- **`SessionHeader`** fixture shape changed
  (`dsh-user-correction-miner/tests/fixtures/sessions.ts:7`).
- **Preset registry face.** `AgentPresetRegistry` no longer has `authorable` and
  `copy`, which `dsh-preset-persona-editor/src/host/preset-reader.ts`'s
  `PresetRosterFace` expects (`src/host/service.ts:114`). The roster was split
  across `dsh-agent-preset` / `dsh-agent-preset-registry`; the copy-to-writable-root
  capability needs a new call site — **[unverified]** where it went.
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
- **`Session.eventAt` / `snapshotEvents` / `ownEvents` are deprecated but alive**
  at rc.1 (`packages/core/session/src/index.ts:647`) — no compile errors, which is
  why the trial bump stayed quiet about them. ~14 call sites across
  `dsh-answer-review-gate`, `dsh-doc-impact`, `dsh-jev-compaction`,
  `dsh-openviking-memory`, `dsh-qa-surface`.
- **`Fiber.update()` no longer returns the waterfall promise** (now `void`), and
  the `internal/update` event's `next` is sync-only. Any `await ctx.fiber.update(...)`
  silently resolves to `undefined`.
- **`schemastery` `Schema<S, T>` gained a third type parameter** (`Mode`). Our
  `as z<UIRepairPluginConfig>` style casts still work, but any conditional type
  written `X extends Schema<infer S, unknown>` mis-captures.
- Client bundle format is unchanged: `window.__ModuleLoader__.load({ id, factory })`
  with `id === package.json.name`, and `/plugins/<full-package-name>/client.js`
  both still hold — so the AGENTS.md module-identity rule needs no change.
- `ConfigFormSnapshot`'s memory mode is **not** new: `persistence =
  ctx.remote.$host.isLoopback ? 'host' : 'memory'` is identical at both tags. A
  non-loopback browser already got read-only settings at 0.1.5, which is why
  `AGENTS.md` routes must-work-without-loopback UI to `settings.plugins.tab`.
  **No availability regression** — do not treat this as a 0.1.7 blocker.

## 6. Mechanical version-metadata wave

97 files carry the literal `0.1.5-rc.2` (excluding `node_modules` /
`pnpm-lock.yaml`). `pnpm check` does **not** cross-check the catalog against the
plugin ranges — `scripts/check-dependencies.sh` has no version assertion at all —
so a half-finished bump fails nothing. The list below is the manual gate.

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
