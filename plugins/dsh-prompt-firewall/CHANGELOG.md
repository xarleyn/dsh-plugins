## 0.2.5 (2026-10-08)

### 🩹 Fixes

- A refusal block reads as a refusal again, and a token the Host never declares ([#717](https://github.com/xarleyn/dsh-plugins/issues/717))
  cannot be written down unnoticed.

  Unknown `var(--dsw-…)` is not a missing colour: the substitution yields the
  guaranteed-invalid value, so the browser drops the whole declaration at
  computed-value time and says nothing. `--dsw-alias-bg-error` and
  `--dsw-alias-label-error` are named by no theme sheet — the error ramp is
  `--dsw-alias-state-error-primary` — so every block of refusal text written with
  them lost its fill and its ink together and rendered as ordinary small text,
  which is how issue #717 looked on the Memory tab of a stand with no access to
  the service. The same mechanic had already cost `dsh-sleev` its focus and
  invalid borders (`--dsw-alias-border-brand`, `--dsw-alias-border-error`) and
  `dsh-session-scope` its chip fill (`--dsw-alias-fill-tsp-secondary`).

  Text and borders now take `--dsw-alias-state-error-primary` with a `#b3261e`
  fallback. The theme declares no error *surface* alias — `state-success` and
  `state-warn` have a tint, `state-error` does not — so a block mixes the state
  token the way the Host's own danger control does,
  `color-mix(in srgb, … 8%, transparent)`, and keeps its soft red in both themes.
  Three names that only ever survived behind a fallback are retired where a live
  token exists (`--dsw-alias-bg-elevated` → `--dsw-alias-button-elevated-fill`,
  `--dsw-alias-label-inverse` → `--dsw-alias-label-primary-foreground`), and
  `--dsw-font-family-mono`, for which the theme offers no alias at all, becomes
  the `ui-monospace` stack the other bundles already write. No computed value
  changes except where a dead name had been silently winning.

  `pnpm verify:tokens` (`scripts/verify-design-tokens.mjs`) is the class turned
  into a gate: it collects every `--dsw-*` name substituted under any package's
  `src/` and refuses one the installed `@deepseek-ai/dsh-client-ui-theme` does not
  declare — a dead name behind a fallback included, because the fallback paints a
  colour the Host never chose. The vocabulary comes from the pinned package rather
  than a hand-kept list, so the check needs no harness checkout and reads the same
  version the plugins build against; where the theme cannot be found the gate
  reports that instead of passing. `dsh-plugin-log-ui`'s own bundle pin flips from
  requiring `--dsw-alias-bg-error` to forbidding the dead error names.

- Every plugin row on the Host's Plugins page is named in words. ([fff88762](https://github.com/xarleyn/dsh-plugins/commit/fff88762))

  The page titles a bundle's row and fills its description line from the package's
  exported `locale/en.json`, which the Host resolves through the package's `exports`
  map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
  Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
  their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
  first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
  `locale/*.json`, and carries English `meta.title` and `meta.description`; where the
  package already had a configuration card, its `summary` one-liner and the row's
  description are one string, pinned by a test against the shipped file rather than
  against a copy in the test. `pnpm verify:packages` asks all three halves of every
  plugin package, so a row cannot fall back to a specifier unnoticed.

  Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
  panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
  row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
  namespace the Host serves the form under, so no saved value is orphaned — and with the
  seat it gives up its shell, its header badge and its show/hide labels, taking the
  Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
  unavailable namespace with a sentence instead of an empty section.
  `dsh-domain-experts` owns no form — it edits domains through its Remote services — so
  it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
  drops the `<h2>` heading and the intro line the panel already draws from the row's own
  display metadata.

### ❤️ Thank You

- qoder-bot
- xarleyn

## 0.2.4 (2026-10-04)

### 🩹 Fixes

- Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover. ([#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#509](https://github.com/xarleyn/dsh-plugins/issues/509))

  `compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
  release, and the Requirements/Compatibility lines of the README and SPEC that
  restate that pair moved with it, so a package page and its manifest agree. The
  checks that hard-code the pair moved in the same change: two `deepEqual`
  assertions in the package verifiers, one bundle test, the plugin generator's
  scaffold defaults with its test, and the fixtures of the repository gates that
  read them.

  Dated records keep the version they were written against. Phase 0 and spike
  findings documents, `SPEC` baseline tags and permalinks into the harness tree,
  and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
  what was observed on that host rather than what the package supports now.

- The plugin's own configuration became the live settings namespace, and its card moved to a slot the 0.1.7-rc.2 host still serves. ([#522](https://github.com/xarleyn/dsh-plugins/issues/522))

  `0.1.7` rewrote the settings subsystem: `ctx.settings.installSection` and the
  `settings.plugin.item` slot are gone, and the two things they kept apart — the
  profile `Config` and a separately registered live namespace — became one. A
  field is editable while the plugin runs exactly when its schema node carries
  `.volatile()`, and the namespace is the profile entry id. The package still
  called `installSection` and registered its card in the deleted slot, so it
  neither compiled nor showed a configuration page against an rc.2 host.

  Every editable field of the config schema is now a volatile reference — the
  nested `audit` and `metrics` containers each as one reference, which is what
  the card writes when it changes a single switch inside them. The class dropped
  its cached resolved config, its compiled rules and its `reloadRules()` hook: it
  takes one snapshot per operation instead, so a Host commit into the running
  entry is the only thing that changes behaviour and there is no local copy that
  could go stale. The namespace constant carries the entry id
  `dsh-prompt-firewall` rather than the Cordis plugin id `prompt-firewall`, which
  is what `settings.update()` addresses a section by.

  The card registers under `settings.plugins.tab` — the slot that survived the
  rewrite, and where the plugin's Remote-backed inspector belongs — reading and
  writing through `ctx.configForms`. It keeps the shared card shell, per the
  epic's D1: the outer markup, the canonical stylesheet and the chevron are
  unchanged, and the `<li>` root now sits in a list the plugin owns. Callers see
  the same `inspect()` and `setSectionPolicy()` surface with the same
  `allow`/`block`/`protect`/`clear` vocabulary and the same revision fence; only
  where a deployment edits the settings and what a stale write is refused by
  moved.

- The Prompt Firewall settings card is now addressable by a stable hook. ([#471](https://github.com/xarleyn/dsh-plugins/issues/471))

  Every section of the card — Policy, Last request, Rules, the Audit & metrics
  drawer and the Prompt Inspector — carries a `data-testid`, as do its toggles,
  selects and inputs, its empty/error states and the per-row actions of the rules
  list and the inspector table. The ids are ASCII kebab-case under the `pf-` zone
  (`pf-policy-mode`, `pf-audit-preview-chars`, `pf-rules-add`, …); a repeated node
  is numbered by its place in the list (`pf-inspector-row-0-block`,
  `pf-rules-row-1-remove`) rather than by the section name it holds, so a browser
  test reaches a control without reading its English caption or a BEM class, and no
  two ids in the package collide.

  Only an attribute was added: the markup, the card shell and the rendered text are
  unchanged, and the existing logic tests do not touch these nodes, so none needed
  rewriting.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-13)

### 🩹 Fixes

- Make the published packages discoverable to the DSH ecosystem. npm only serves ([76bdc53](https://github.com/xarleyn/dsh-plugins/commit/76bdc53))
  what a published tarball carries, so every package now ships the canonical
  keyword set (`deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`) plus
  its own feature words, alongside the repository, homepage, and bug-tracker
  metadata that ties the package back to its directory in this monorepo. DSH
  directories and marketplace indexes discover plugins through those keywords and
  through the `dsh-plugin` GitHub topic, and an indexer that cannot attribute a
  package to its sources reports it as published without a public repository.
  Packages that ship no keywords at all were invisible to those indexes. The
  repository root also gains a generated `plugins.json` catalog that maps every
  npm name to its directory, install command, and homepage, and the package
  hygiene gate now rejects a manifest whose metadata is missing or stale.

  The published tarball also stops carrying repository documentation — specs,
  changelogs, roadmaps, design docs, integration notes, and README translations
  stay in the repository, so an install pulls the runtime and the bundle patch
  instead of prose. Relative links in a published README now point at GitHub
  where the tarball no longer holds the target.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-12)

### 🚀 Features

- Migrate to the 0.1.5 settings surface (SettingsProvider.installSection ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  inside ctx.inject(['settings'])), declare the gateway remote and renderer
  slot Context merges, and expect the persona-prefix/persona-suffix
  system-prompt sections. The supported host range moves to
  >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.3 (2026-09-06)

### 🩹 Fixes

- Prevent slot mutation while inference streams are active, validate llama.cpp ([f97114e](https://github.com/xarleyn/dsh-plugins/commit/f97114e))
  management responses, use the shared DSH home, make correction truncation
  Unicode-safe, bound miner retention and pending state, restore strict host
  type checking for session scope, pause UI polling in hidden tabs, and align
  published package metadata, compatibility declarations, and build lifecycle
  gates.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn