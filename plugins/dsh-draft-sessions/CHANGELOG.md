## 0.3.6 (2026-10-08)

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
- xarleyn @xarleyn

## 0.3.5 (2026-10-04)

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

- Drafts now hold their Session the way the Host expects a feature to own one. ([#525](https://github.com/xarleyn/dsh-plugins/issues/525))

  Opening a draft used to hand the Host a navigation request and then trust that
  the Session behind the draft was ready. The Host no longer navigates on behalf
  of a feature: a Session counts as open while the feature that asked for it keeps
  holding it, and it is torn down once nothing holds it. The composer therefore
  takes that hold when it starts mirroring a draft and gives it up when the draft
  is closed, replaced by another, or deleted. Reopening also waits for the
  Session's first history attempt to settle before the saved text is put into the
  composer, so the text no longer lands in a scope that is still arriving; when
  the Session never becomes usable, the composer still reports the draft as having
  no client scope, and now releases the hold it took before saying so.

  Which Workspace a new draft lands in is read from the same hold: the Session of
  the draft being composed first, and the most recently active Workspace
  otherwise. Deleting the draft currently on screen no longer asks the Host to
  clear a selection — releasing the hold is what makes that Session not current
  any more.

- Reopening a draft no longer puts older text back into the composer. ([#357](https://github.com/xarleyn/dsh-plugins/issues/357))

  Every seat that opens a draft hands the composer a record of its own, and a
  record taken before an autosave had settled describes the draft as it was
  earlier. The composer used to restore exactly what that record said: the words
  on screen jumped back to the superseded text while the durable draft kept the
  newer one, and the next edit was written against the revision that text had been
  saved with. The Host answered `DRAFT_STALE_REVISION` — a conflict with another
  browser that had never happened, on a draft whose saved text the composer had
  just thrown away from view. Nothing was lost durably, and everything looked
  lost.

  Opening now restores the record the flush had just returned whenever that flush
  concerned the same draft, so the composer shows the text the Host accepted and
  the next save carries the revision that text earned. A draft that still needs
  its Session shell is covered by the same repair: the shell is claimed with the
  current revision rather than the one the caller happened to be holding.

  Navigation is now serialized the way saving already was. Two reopen requests no
  longer look up a Session and create a shell at the same time, so the slower one
  can no longer finish after the faster one and leave the composer mirroring a
  draft the Host is not showing.

- Test coverage now comes from the shared Vitest preset, so `pnpm run ([#291](https://github.com/xarleyn/dsh-plugins/issues/291))
  test:coverage` measures the same tree in every package and writes the same
  machine-readable `coverage/coverage-summary.json` beside the printed table.

  Until this release the preset carried no coverage block at all, so whatever a
  package listed as its `include` was the whole denominator. That choice is gone:
  `mergeConfig` concatenates arrays instead of replacing them, so a re-declared
  `include` can only widen the tree and `exclude` is the only way left to measure
  less. The blocks are dropped rather than rewritten, which means a package that
  used to measure part of its sources now measures all of them, client code
  included. Where that happens the percentage falls with the wider denominator
  while not a single test changed, and the number is comparable with the other
  packages of this workspace but not with what the same package printed before.
  Neither is it comparable with the older test-lines-per-source-lines ratio, which
  counted words instead of executed statements.

  No thresholds on purpose: the percentage is a measurement to read before a
  refactor, not a gate that competes with the per-file size budget. No runtime
  change.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- Claude
- qoder-bot

## 0.3.4 (2026-09-22)

### 🩹 Fixes

- Five client bundles stop letting a literal decide a surface, a status or an ([54c2bcc](https://github.com/xarleyn/dsh-plugins/commit/54c2bcc))
  elevation (#254).

  The audited rule is the one the guidelines state: UI is built from
  `--dsw-alias-*` tokens, and a literal may only carry a narrow semantic accent.
  Outside `dsh-qa-surface` (excluded by the card), the sweep found two statuses
  and two elevations that broke it:

  - `dsh-domain-experts` defined its own `--dx-ok/--dx-warn/--dx-danger` with hex
    literals, so enforced, advisory and error text kept a fixed green, amber and
    red in every theme. They now resolve to the host's
    `--dsw-alias-state-{success,warn,error}-primary`, which the rest of the
    repository already uses; the local names stay, so no rule changed shape.
  - `dsh-qa-browser`'s canvas and its tab menu carried literal `box-shadow`
    values. They now ask for `--dsw-shadow-lv2`/`--dsw-shadow-lv3` - the tokens
    `dsh-qa-surface` and `dsh-draft-sessions` already use - and keep the previous
    value as the fallback, so an older host renders exactly as before.
  - `dsh-draft-sessions` wrote the same idea as `--dsw-shadow-l2`, a name no host
    defines; the literal fallback hid it, which is why it survived. Corrected to
    `--dsw-shadow-lv2`.
  - `dsh-documents` asked for `--dsw-label-tertiary` first and only fell back to
    the token that exists; the dead first name is gone.
  - `dsh-doc-impact`'s transparent button border was spelled `#0000`; the keyword
    `transparent` says the same thing without a color literal.

  What stayed is what the rule allows: the remaining literals in these bundles are
  all fallbacks inside `var(<token>, <literal>)`, never the value a themed host
  would resolve. Typography literals were deliberately not touched - the canonical
  card shell in AGENTS.md hardcodes its own 15/13/11px sizes, so font sizes are
  the repository's convention rather than a token-governed surface.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the client-bundle gate now asserts the ModuleLoader registration (window.__ModuleLoader__.load) explicitly next to the factory id. No runtime changes. ([73113f3](https://github.com/xarleyn/dsh-plugins/commit/73113f3))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-13)

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

## 0.3.0 (2026-09-12)

### 🚀 Features

- Rebuild the draft-sessions client on the 0.1.5 session/workspace controllers: ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  the client-runtime face is gone, session creation goes through the ISessions
  list store with a throwing create, prompt observation rides the forwarded
  api-session/status event, and workspace resolution follows the host
  recent-workspace heuristic over WorkspaceSnapshot. The supported host range
  moves to >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-06)

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

## 0.2.1 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-08-30

### Added

- Added draft rows through the composable Harness sidebar slot without replacing or embedding the active workspace browser.
- Excluded backing blank Sessions only from the workspace-browser standard hooks, preserving Archive Manager and ordinary browser behavior.
- Added a visible Drafts `+` action that flushes the current draft before creating and opening a distinct one.
- Portaled draft row menus above sidebar panels so opening a menu cannot expand or clip inside the draft scroller.
- Activated draft controllers from a context explicitly injected with the dynamically mounted `remote.draftSessions` service.
- Restored the production `Ctrl/Cmd + Shift + N` listener when controller dependencies are supplied explicitly.
- Memoized draft-filtered Session and Workspace selector snapshots to prevent React external-store update loops.
- Versioned Host-backed DraftStore with atomic JSON persistence.
- CRUD, ordering, per-Workspace limits, recovery rebinding, and optimistic revisions.
- Strict Typert Remote contribution for the Web client.
- Client lifecycle bridge for distinct blank Session creation and missing-shell recovery.
- Accepted-prompt observation and blank-to-materialized DraftRecord finalization.
- Official InputHub restore and serialized debounced optimistic autosave.
- Current/recent-Workspace `Ctrl/Cmd + Shift + N` draft creation.
- Draft-first sidebar projection with backing-shell deduplication and optimistic reorder plans.
- Initial tests, architecture documentation, specification, roadmap, and CI.
