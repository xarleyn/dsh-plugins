## 0.1.7 (2026-10-04)

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

- The parent-context test injects its fake context under a source kind the host ([#532](https://github.com/xarleyn/dsh-plugins/issues/532), [#511](https://github.com/xarleyn/dsh-plugins/issues/511))
  actually has.

  The suite simulated a non-human user-role message with `kind: "plugin"`. No such
  producer exists at `0.1.7`: a message's source map is `user`, `model`, `tool` and
  `system-prompt`, which each producer extends with its own kind, and `plugin` sits
  on neither axis. The fixture now names `time-context`, a host package that really
  does prepend a user-role message to the turn, so the case asserts what its name
  promises.

  Nothing in the extractor moved. `source.kind === "user"` stays the only human
  producer, and because the map is merge-extensible the guard has to fall through
  unfamiliar kinds rather than carry a list of them — which is why its comment and
  the test header no longer say "plugin-injected".

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.1.6 (2026-09-22)

### 🩹 Fixes

- The offload fixtures are shared instead of copied. ([89470e0](https://github.com/xarleyn/dsh-plugins/commit/89470e0))

  Each test grew its own payloads, and two of them had already drifted apart, so
  a fixture that stopped matching what the plugin sends kept passing. The payloads
  now live in one fixture module the suite imports.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.5 (2026-09-22)

### 🩹 Fixes

- A reload no longer leaves the offload listener running. ([ec43092](https://github.com/xarleyn/dsh-plugins/commit/ec43092))

  The `tools/post-execute` listener was registered with its undo action pushed
  into a local array that `dispose()` never saw, so the plugin's own promise —
  "unload/reload leaves tool execution unchanged, listener registration is
  disposed symmetrically" — was not kept: a reloaded service could not remove the
  previous listener, and the runtime arriving during teardown would have mounted
  into the same unreachable list.

  The undo actions now live on the service, `dispose()` walks them, and a runtime
  that arrives after disposal mounts nothing.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.1.4 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the plugin consumes the shared `PluginLoggerLike` contract from `@yadsh/dsh-plugin-log` instead of a private copy, and its package verification gates run through the shared runner. No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.3 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.2 (2026-09-13)

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

## 0.1.1 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  compatibility contract and README requirements move to
  `>=0.1.5-rc.2 <0.2.0`.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-10)

### 🚀 Features

- Initial release: large successful textual tool results (read, grep/search, ([0c0feec](https://github.com/xarleyn/dsh-plugins/commit/0c0feec))
  web_fetch by default, ≥ 24 KB or ≥ 6 000 estimated tokens) are processed by a
  cheap one-shot no-tools worker started through `ctx.subagents`, and only the
  model-facing content is replaced with the worker's compact, validated answer.
  Deterministic allowlist/denylist routing with ordered rules, bounded parent
  context behind injection-safe prompt boundaries, worker timeout and parent
  cancellation, non-blocking per-agent/global concurrency budgets, bundled and
  custom prompt profiles, `original`/`truncate`/`error` fallbacks, recursion
  guards, and structured telemetry with reduction metrics.

### ❤️ Thank You

- xarleyn @xarleyn