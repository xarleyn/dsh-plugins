## 0.1.8 (2026-10-04)

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

- The protected-surface table now names the harness-owned surfaces by the stable ([#473](https://github.com/xarleyn/dsh-plugins/issues/473), [#453](https://github.com/xarleyn/dsh-plugins/issues/453))
  `data-testid` epic #453 gave them, instead of only guessing from a class name.

  A surface that holds someone else's text — a rendered Markdown block, a quoted
  source snippet, a line of the log buffer — must never be rewritten by the
  translator. Until now it was caught only when its class or test id happened to
  read like a conversation buffer, so `qa-md-table`, `qa-md-code` or
  `qa-source-detail-snippet` stayed translatable while its own markup says plainly
  what it is. Those ids are listed now, the Markdown zone by its prefix, and the
  class keywords stay as the fallback for markup that carries no test id yet — the
  host's own surfaces among them. Both the selector list and the heuristic that
  notices a protection was removed are built from the same tables, so a surface
  cannot be protected on one path and missed on the other.

  Nothing was widened past the id it names: the table matches a prefix, not a
  substring, so a surface that merely looks alike stays translatable, and the
  composer keeps its protection only as a test id, because its class is layout.
  The package's own checks reached several nodes through a class, which is the
  attribute a translation scope is written in and the one the tests themselves
  rewrite; those locators moved to `data-testid`, and every assertion on visible
  text, on an attribute or on `aria-label` stayed where it was. Only attributes
  were added to the fixtures — no element moved, so the markup tests exactly what
  it tested before.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.1.7 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the package's oversized test files are split into per-domain ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  files with shared helpers (`registry`, `dom-translator`, `locale-hook`,
  `integration`). No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.6 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.5 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.4 (2026-09-13)

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

## 0.1.3 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  compatibility contract and README requirements move to
  >=0.1.5-rc.2 <0.2.0.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-06)

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

## 0.1.1 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn
