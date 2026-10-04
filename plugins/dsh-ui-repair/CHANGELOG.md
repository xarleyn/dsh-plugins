## 0.3.0 (2026-10-04)

### 🚀 Features

- The UI Repair settings card opens from the Plugins panel now, not from a tab of ([#647](https://github.com/xarleyn/dsh-plugins/issues/647))
  the Settings "Built-in plugins" section.

  The card edits exactly one thing — this bundle's own Config — and the panel
  declares a configuration seat for that: `plugins.row.config`, keyed by
  `<package name>#<row id>`. The row this bundle's `cordis.patch.yml` declares is
  `dsh-ui-repair`, the same string the Host has resolved the plugin's live Config
  under since `0.1.7`, and the id its settings tab was filed under before this
  release, so the seat moved and the namespace did not: a mode, a confidence
  threshold or a list of ignored selectors saved before this release is read back by
  the card after it.

  The card is the settings body only. The panel's row page draws the card surface,
  the heading and the expand control before it mounts this bundle into its
  configuration section, so the bundle ships no outer frame, no title line, no
  chevron and no list item of its own — repeating that chrome inside the Host's card
  draws a second frame and a second heading next to a first-party row. What the body
  does bring is a focus ring on every control it renders — its fields, its toggle and
  its buttons — taken from the Host's own `--dsw-focus-ring-width` and
  `--dsw-focus-ring-color` tokens, each with a fallback, because a hard-coded outline
  of ours loses to the Host's focus styling after a mouse click.

  The page asks this entry for two views. The body belongs to the `page` view, and it
  keeps resolving its own live configuration through the settings domain rather than
  taking the page's `{ state, mutate }` view, which can neither be subscribed to nor
  written field by field; that form arrives in the card's face as `settings`, because
  the page hands its registrant a prop called `form`. The `summary` view is answered
  with one plain sentence and no store read, since the page prints it into the row's
  description paragraph — a card there would draw a page within a line of text.

  The row answers every state its namespace reports. Returning nothing was the right
  answer for a card that drew its own frame; inside a frame the page drew, silence left
  an opened row with an empty configuration section and no reason attached. So an
  unavailable namespace now says the settings are not exposed to this browser session,
  and a namespace that has not answered yet says so — instead of drawing the plugin's
  built-in defaults as if they were the saved policy. The scan panel keeps its place in
  either case: it reads the runtime rather than the settings, and rolling back temporary
  repairs is the action an operator has left on a stand whose settings are closed. The
  two actions that answer to the mode — Apply and Ignore on a reported issue — keep
  waiting for it: an issue the scan found is still listed, but a repair is not offered
  under a mode the row has just said it has not read, and certainly not under one it
  took from its own built-in defaults.

  Nothing else moved: the runtime, the scans, the repair actions and the write path of
  every field are untouched.


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

- The card reads its settings the way a 0.1.7-rc.2 host serves them, and is found again. ([#523](https://github.com/xarleyn/dsh-plugins/issues/523), [#508](https://github.com/xarleyn/dsh-plugins/issues/508), [#511](https://github.com/xarleyn/dsh-plugins/issues/511), [#512](https://github.com/xarleyn/dsh-plugins/issues/512))

  Under `0.1.5` the browser half edited a settings namespace the host half had
  installed itself, so the namespace was a name this package invented. `0.1.7`
  removed that installation: a field is editable while its schema node is marked
  live, and the namespace of such a profile is the profile entry id. Every field of
  UI Repair is editable, so all eight now carry `.volatile()`, and the namespace is
  `dsh-ui-repair` — the id `cordis.patch.yml` already declares. A policy written
  under the old `ui-repair` section is therefore not read by this build, and the card
  mounts as its own tab of the Plugins settings section, keeping the card shell this
  package draws for itself.

  Reading changed too. A live field is a reference, so the host companion takes one
  snapshot per operation instead of cloning the profile once at entry — a clone made
  the values it logged permanent, which is how the entry-time log and the card's own
  policy could disagree. The companion now logs readiness from a snapshot and stops
  logging changes: the signal it used to hook was the installation's callback, and
  the live path runs through the card, which already re-applies every policy field as
  the form reports it.

  The repair scanner lost one place to look. It had treated the children of the old
  card slot as plugin surfaces to diagnose, and `0.1.7` emits no marker for that slot
  because the slot is gone; the cards it meant are now found through the shell class
  the repository's own card contract pins them on. Surfaces that carry an explicit
  `data-dsh-ui-repair-root` or a plugin attribute are discovered exactly as before,
  and the card still excludes its own body from every scan.

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

- The repair settings card carries stable `data-testid` selectors. ([#472](https://github.com/xarleyn/dsh-plugins/issues/472))

  Every control the card renders — the four policy switches, the mode and
  confidence fields, the scan and rollback actions, the per-issue Apply and Ignore
  buttons and the ignored-selector form — is now addressable by a test id, so a
  browser test of the card survives a rephrasing of its labels. The card keeps the
  `data-dsh-ui-repair-*` attributes it already used to keep itself out of its own
  scan; the ids sit beside them and nothing was renamed.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1
- Updated @yadsh/dsh-plugin-kit to 0.5.0

### ❤️ Thank You

- qoder-bot

## 0.2.5 (2026-09-22)

### 🩹 Fixes

- The client bundle has one named build step instead of a side effect of `test`. ([3d4f384](https://github.com/xarleyn/dsh-plugins/commit/3d4f384))

  Bundling `lib/client.js` lived inside the `test` script as an anonymous `tsdown`
  invocation, so the artifact the verification gate reads was whichever command
  ran last: a suite could pass against a bundle no build had produced, and `build`
  — which deletes `lib/` before it writes — could take that same file away while
  a suite was loading it.

  The step is now the named `build:client` goal. `build` reuses it after the
  clean, `test` consumes the goal instead of invoking the bundler on its own, and
  a wiring test fails if either script grows the step back.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.4 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the runtime test monolith is split into lifecycle, repair and ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  scan domains with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates (including the client-bundle card contract) now import the canonical module from `@yadsh/dsh-plugin-scripts`. No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

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

- Migrate to the 0.1.5 settings surface: the settings section installs via ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  SettingsProvider.installSection under ctx.inject(['settings']) with the
  plain "ui-repair" namespace, and ctx.slots resolves through the
  client-ui-renderer merge. The supported host range moves to
  `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-10)

### 🩹 Fixes

- Initial release: conservative DOM diagnostics and scoped repairs for DeepSeek ([0e4b2c3](https://github.com/xarleyn/dsh-plugins/commit/0e4b2c3))
  Harness plugin UIs. Semantic repair roots replace coupling to hashed
  CSS-module classes; R001 repeated-row icon alignment, R006 unexpected vertical
  overflow, and R007 clipped-content diagnostics run in `observe`, `suggest`,
  and conservative `auto` modes with animation-frame layout stabilization,
  verification, and rollback. Allowlisted CSS writes stay scoped by per-repair
  data attributes, bounded initial scans gain mutation-triggered targeted
  rescans, repair history stays in memory, and every owned attribute and style
  tag is restored on unload.

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 (2026-09-09)

- Add the installable host and classic-browser plugin skeleton.
- Add bounded overflow, clipping, and repeated-icon alignment diagnostics.
- Add observe, suggest, and conservative auto modes with scoped CSS writes,
  layout stabilization, verification, history, and rollback.
- Add targeted mutation rescans and unit/browser-bundle contract coverage.
- Add a persistent `ui-repair` settings section and canonical plugin card.
- Add selector/plugin/rule ignore policies and live runtime configuration.
- Add manual Suggest-mode apply/ignore actions and built-in rules R002, R005,
  R008, and R009 with opt-in guards for ambiguous layout ownership.
- Add R003/R004 row diagnostics, bounded ResizeObserver rescans, and plugin
  attribution across common stable DOM metadata.
- Add R010-R013 gap, padding, text-overflow, and parent-containment diagnostics
  with explicit ownership markers for automatic repair.
