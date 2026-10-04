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

- A mined correction keeps the tool output that provoked it on harness 0.1.7. ([#528](https://github.com/xarleyn/dsh-plugins/issues/528), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))

  The harness retired the `tool-result` content block: one tool result is now a
  first-class `tool`-role message whose own `content` is the result, so the text
  walker in the mining pipeline unwrapped a block the host no longer emits and
  every tool result reaching a correction would have arrived as empty context. The
  walker now reads the text blocks that the new message shape actually carries.

  The session fixtures were rebuilt on the current vocabulary instead of patched
  in place, because a fixture is the only place this package states what a session
  looks like: the header is stamped from `SESSION_FORMAT_VERSION` and branded
  through `SessionId` rather than hand-written at version 3, an injected
  non-human message carries a real producer source kind since `plugin` is absent
  from both the role and the source axes, and the tool-result fixture emits the
  `tool` role with its `toolCallId`.

  Two things were checked and deliberately left alone. `session.snapshotEvents()`
  is still merely deprecated in the host, so the live-session path keeps its call
  site, and the plugin's own `tool-result` context label — in its types, its
  extractor and its durable schema — is our vocabulary around a session event that
  survives, not the retired content block. A corrupt stored session, which the
  host's observation reader now reports as a catchable
  `SESSION_QUERY_CORRUPT_SESSION`, counts as one failed session and the scan
  continues with the rest of the workspace, which the engine suite already pins.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: tests share the `fixedClock` fixture from `@yadsh/dsh-test-kit`, and package verification gates run through the shared runner. No runtime changes. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

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

- Port to the DSH session format v3: the live-session snapshot feeds from ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  session.snapshotEvents() and fixtures use the isSeeded header with branded
  log offsets. The supported host range moves to >=0.1.5-rc.2 <0.2.0, dropping
  0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-06)

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

# @yadsh/dsh-user-correction-miner

## 0.1.0 (2026-09-05)

### 🚀 Features

- First release: Phase 1 evidence mining from user corrections — historical
  scans and live session observation with privacy redaction, retention caps,
  and the `/corrections` command family for listing mined corrections.

### ❤️ Thank You

- xarleyn @xarleyn
