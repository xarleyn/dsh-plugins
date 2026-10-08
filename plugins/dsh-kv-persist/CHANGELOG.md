## 0.2.9 (2026-10-08)

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

## 0.2.8 (2026-10-04)

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

- A session request that arrives after shutdown is now refused out loud. ([#432](https://github.com/xarleyn/dsh-plugins/issues/432))

  Disabling the plugin stopped its timers and wrote the final checkpoint, but it
  did not close the door: a request that reached the coordinator afterwards was
  still welcomed in. It created the session bookkeeping it had just been told to
  forget, waited for the slot, asked the server for state, and streamed an answer
  — persistence work running on a component that had already said it was done. A
  request that was queued behind a stream still in flight joined it, and then ran
  anyway once the slot came free. Both cases now get an explicit refusal that
  names the disposal instead of the work: the request never reaches the server,
  and the final checkpoint shutdown asked for still runs unobstructed.

- A KV snapshot now survives both the shutdown it was written for and the restore ([#345](https://github.com/xarleyn/dsh-plugins/issues/345))
  that failed.

  Shutting DSH down discarded the conversation state the plugin had promised to
  keep. The disposal sequence announced itself as disposed before asking the
  coordinator for the final checkpoint, and the checkpoint saw that announcement
  and stepped aside, so a session whose last turn was still unsaved was never
  saved. Nothing complained: the snapshot simply described a conversation one turn
  shorter than the one the user closed the session with. The shutdown checkpoint
  now runs through its own path, still refused to everything that wants to start
  new work, and it still waits behind an inference stream that has not finished so
  it sees the turn that stream produced.

  A snapshot that failed to come back could never come back again. A restore
  failure marked the manifest invalid, which is right, and every later save then
  rewrote the snapshot file underneath that manifest while leaving it invalid — so
  the plugin kept saving work it would never read, and each new session started
  cold no matter how many snapshots it had written. A successful save now returns
  its manifest to the ready state and drops the reason, including after the runtime
  fingerprint changed, where the saved bytes belong to the new runtime and the
  manifest said otherwise.

  Unloading the plugin now finishes even when it cannot finish saving. The final
  checkpoint waits its turn behind an inference stream that still holds the slot,
  so a stream that never closes used to hold the unload with it. Disposal waits
  for the checkpoint up to the new `checkpoint.shutdownGraceMs` option (five
  seconds by default) and then releases the host, logging
  `kv.session.shutdown_flush_abandoned`; the checkpoint is not cancelled and still
  writes as soon as the slot is free.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.2.7 (2026-09-22)

### 🩹 Fixes

- A route key's separator no longer makes the file binary. ([0a70f14](https://github.com/xarleyn/dsh-plugins/commit/0a70f14))

  `manifestRouteKey` joined the provider and the model with a literal NUL byte.
  Git reads such a file as binary: the diff of `snapshots/manifest.ts` became
  "Binary files differ", so a change to how keys are composed could not be
  reviewed at all. The separator is now the same character written as an escape,
  the key is byte-for-byte what it was, and the file diffs as text again.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.6 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.5 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.4 (2026-09-13)

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

## 0.2.3 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  compatibility contract and README requirements move to
  >=0.1.5-rc.2 <0.2.0.

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

## 0.2.1 (2026-08-31)

### 🩹 Fixes

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-08-30)

### 🚀 Features

- Add the dsh-kv-persist plugin: a persistent KV-cache/session-state manager for ([0e5d284](https://github.com/xarleyn/dsh-plugins/commit/0e5d284))
  DeepSeek Harness. v0.1 maps DSH sessions to llama.cpp slot snapshots
  (`--slot-save-path`) with lazy restore, save-before-switch, idle and
  shutdown/session-flush checkpoints, dirty-generation coalescing, runtime
  compatibility gating, cold fallback on every persistence failure, a failure
  circuit breaker, local atomic metadata manifests, and a `ctx.kvPersist`
  service exposing status, save/restore/invalidate/purge/flush, and doctor
  diagnostics. Managed providers are opt-in; all other providers pass through
  untouched.

### ❤️ Thank You

- xarleyn @xarleyn