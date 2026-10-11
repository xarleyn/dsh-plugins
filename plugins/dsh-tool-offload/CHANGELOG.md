## 0.1.9 (2026-10-08)

### 🩹 Fixes

- A worker whose profile names no model follows the QA policy of the chat. ([#766](https://github.com/xarleyn/dsh-plugins/issues/766))

  `WorkerProfileConfig` documents `provider` and `model` as `null` meaning "inherit
  the parent", and the parent's model is whatever the chat was put on — including a
  model a visitor picked in the interface. The runner now asks the host's QA surface
  (`qa-policy.ts`, read structurally and per call, absent on a deployment with no
  accounts surface) for the pair the policy fixes for the session the tool result came
  from, and sends that pair only when the profile leaves `model` unset. A profile that
  pins its own model is untouched, and the plugin behaves exactly as before where no
  policy speaks.

  Covered by `tests/integration/qa-model-policy.test.ts` (the policy pair is sent with
  the parent session named, a pinned profile never asks, no policy leaves the child
  inheriting, and a runner built without a policy source runs unchanged).

### ❤️ Thank You

- qoder-bot

## 0.1.8 (2026-10-08)

### 🩹 Fixes

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

- xarleyn

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