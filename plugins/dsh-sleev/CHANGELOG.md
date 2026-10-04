## 0.2.0 (2026-10-04)

### 🚀 Features

- The observer's settings card moves out of Settings and onto the Plugins panel. ([#650](https://github.com/xarleyn/dsh-plugins/issues/650))

  Its old seat was a tab of the Host's built-in plugin section (`settings.plugins.tab`),
  one page among the plugin pages Settings lists. The Plugins panel is where a bundle is
  installed, switched and opened, and a row that carries configuration has a page of its
  own there; the card now registers as that page, under the seat its bundle row names —
  `@yadsh/dsh-sleev#dsh-sleev` in `plugins.row.config`.

  What the card edits did not move. The settings namespace stays the profile entry id
  `dsh-sleev`, and that id is the very row id the seat is keyed by, so the key a
  deployment stores its values under is the same key the moved card reads — the seat
  move cannot orphan a stored value. The four fields keep staging edits, marking the
  overridden ones, resetting one field to its composition default, and refusing a
  value the schema would reject.
  One thing the new seat does change: on the Settings tab a namespace that had not been
  served left the tab shut, while the row's **Configure** control is drawn from the
  inventory, so an opened row always owes a line. The namespace has three states and now
  gets three answers — a loading line while the first snapshot is on its way, the form
  once it stands, and a stated reason when the settings directory is closed to this
  client, which is where a browser off the loopback address and a memory-mode host sit.
  Neither line is a live region, because the loading one is replaced by the form as soon
  as the namespace answers.

  The card takes the frame the page already draws. The row's detail page paints the
  surface, the row title and the expand control before it mounts what a registration
  returns, so the bundle's own shell is gone rather than nested inside the Host's: no
  border or background of ours, no `<li>` inside a plugin-owned `<ul>`, no header
  button with a chevron, and no injected shell stylesheet. Two things leave with the
  header — the title and the show/hide labels, which the row states for every bundle —
  and one moves: the unsaved marker sits in the footer now, beside the write controls it
  describes. The ring on every control this body draws comes from the Host's
  `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, each half with a fallback:
  a hard-coded outline loses to the Host's `focus.css` under pointer modality, and a
  token with no fallback would drop the whole `outline` shorthand where the Host does
  not declare it.

  The seat's contract comes from `@deepseek-ai/dsh-client-ui-plugin-manager`: its
  `plugins.row.config` entry is handed a `view` of `summary` or `page`, takes the
  one-liner where the page has no description of its own, and renders the form with
  its save control as the page body. Both answers are pinned by the package's tests.
  Reaching the new surface is a host-side requirement, so
  `compatibility.json` now names `plugins.row.config` as the client feature the browser half
  needs, and `dsh.client.inject` names the module that declares the slot: a browser on a
  host without the Plugins panel's row loses the card entirely, which is why this is
  `minor` rather than `patch` — the same step the twins that moved onto this seat took
  (`dsh-model-safety-gate`, `dsh-plugin-log-ui`, `dsh-jev-compaction`).
  The package gate reads the pair from the built bundle (the seat literal inside the
  registration, and the `@yadsh/dsh-sleev#` key prefix the seat is joined from), reads the
  chrome the other way (the ring tokens present, the shell classes, the chevron path and
  the old tab seat absent), and now also rejects any `outline` in the bundle that removes a
  ring — the shared contract only requires a focus rule to exist, and a later
  `outline:none` on a field satisfied it while leaving a clicked field ringless. One
  devDependency left with the shell: `@yadsh/dsh-plugin-kit` supplied `CardShell` and
  `PLUGIN_CARD_SHELL_CSS` and nothing in the package names it now.


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

- The observer reads its own settings, and its card moves to the Plugins tab. ([#520](https://github.com/xarleyn/dsh-plugins/issues/520))

  `0.1.7` unified the two configuration surfaces a plugin used to keep: a field is
  editable in the browser when its schema node says so, and the settings namespace
  is the profile entry that owns it. The observer's four fields — exact routes,
  route prefixes, recent-call retention and telemetry logging — are now declared
  `.volatile()`, so the Loader serves the `dsh-sleev` entry itself as the namespace
  the card edits, and the separately registered `sleev` section is gone. The card
  follows the Host surface that survived the rewrite, the Plugins tab of Settings,
  and resolves the form through `ctx.configForms`; it keeps the shared card shell,
  with the `<li>` root inside the list element this plugin owns.

  Reading changed shape, not meaning. The volatile reference is stable and its
  value is swapped in place, so the observer takes one snapshot per operation
  instead of keeping a source callback the settings layer pushed a newer object
  into; a committed edit still reaches the next matching call without a restart.
  The logger level follows on the first read that sees a different value, because
  the Loader commits a volatile change without re-constructing the service. The
  card still stages edits, marks the unsaved fields, resets one field to its
  composition default, and refuses to save a value the schema would reject. Which
  routes are observed, what is retained, and what is never stored are untouched.

  Two scripts came along for the ride. `smoke:packed` pinned its default harness
  version to `0.1.1-rc.2` — an island no dependency had stood on for several
  releases, so the smoke tested a composition nobody ships; it now reads the last
  entry of `compatibility.json → testedReleases` and refuses an override outside
  that list, which is what its neighbours already do. The live `smoke:neuraldeep`
  script builds its conversation through the current message shapes: a plugin-
  authored user turn is a plain user source, the tool result is a `tool`-role
  message answering its call id, and the assistant source no longer restates its
  own kind.

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

- The Sleev settings card carries stable `data-testid` selectors. ([#472](https://github.com/xarleyn/dsh-plugins/issues/472))

  Each field, its reset action, the Save and Discard footer buttons and the two
  notices are now addressable by a test id. The card's copy is localized into
  English and Chinese, so a label was never a stable locator for a browser test in
  the first place; the id gives one. The `id` attributes the labels point at, the
  read-only and invalid states and every existing class are unchanged.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.1.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: tests share the `fixedClock` fixture from `@yadsh/dsh-test-kit`, and package verification gates run through the shared runner. No runtime changes. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-13)

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

## 0.1.0 (2026-09-12)

### 🚀 Features

- Migrate to the 0.1.5 APIs: SettingsProvider.installSection, renderer-typed ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  ctx.slots, ToolCallId branding in the NeuralDeep smoke, and the
  mutate-based SettingsScope contract. The supported host range moves to
  >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.0.4 (2026-09-06)

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

## 0.0.3 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.0.2 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn
