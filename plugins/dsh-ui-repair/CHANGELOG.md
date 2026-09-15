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
