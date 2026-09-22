## 0.7.5 (2026-09-22)

### 🩹 Fixes

- The browser client is built by tsdown, like every other plugin's client half. ([85c6315](https://github.com/xarleyn/dsh-plugins/commit/85c6315))

  `src/client.ts` used to be a prebuilt bundle living in the source tree: a single
  `@ts-nocheck` script that hand-wrote `window.__ModuleLoader__.load(...)`,
  required `react` and `react-dom` through the factory's own `require`, and was
  copied to `lib/client.js` by `tsc` unchanged. It is now an ordinary ES module
  that exports the Cordis client plugin, and `tsdown` wraps it into the shell's
  classic factory — the same banner, intro and footer every other client uses.

  Nothing the shell sees changes: the bundle still registers exactly
  `@yadsh/dsh-session-scope` through `window.__ModuleLoader__`, still takes
  `react` and `react-dom` as shell statics instead of shipping its own copy, still
  contributes the Scope chip to the composer's left seat, and still reads the
  directory tree through the dedicated non-durable `sessionScope/list` RPC rather
  than through a `/scope` command. Because the artifact is now generated rather
  than authored, the manifest declares `./client` as its bundle path: a
  module-loader bundle is fetched and registered by the shell, so it has no
  importable type surface to point `types` at.

  The client module is part of the package's type and lint surface now: the
  `@ts-nocheck` that covered the whole file is gone, the ported body uses
  `let`/`const` and typed parameters instead of function-scoped declarations, the
  standing ESLint ignore for the file is removed, and the bundle gate runs the
  built registration against a module-loader stub instead of only reading its
  text — a factory that stopped exporting a working plugin now fails the package
  check rather than the browser.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.7.4 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the package's oversized test files are split into core and ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  tool-guard domains with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the legacy `release:prepare` script from the previous release scheme is removed, and package verification gates run through the shared runner. No runtime changes. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.2 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.7.1 (2026-09-13)

### 🩹 Fixes

- Read the session log through the 0.1.5 API so any turn can start. Session ([9fa725c](https://github.com/xarleyn/dsh-plugins/commit/9fa725c))
  format v3 replaced the `session.events` array with `snapshotEvents()`, and the
  plugin still read the removed property. `getScope` resolves the effective scope
  from that log on the very first line of the plugin's prepended `agent/pre-step`
  listener, so the read threw `Cannot read properties of undefined (reading
  'length')` before the step began: every turn in a host that mounts this plugin
  ended as `turn/end {kind:'error'}` without reaching the model. The structural
  `ScopeSession`/`DelegatedScopeSession` interfaces now declare `snapshotEvents()`
  instead of the field, the four call sites use it, and the test fakes expose the
  log through the same method.

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

## 0.7.0 (2026-09-12)

### 🚀 Features

- Adapt the compatibility gate to the 0.1.x rc line and move the supported ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  host range to >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2; the remote $mount
  and commands faces carry over unchanged.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.6.1 (2026-09-06)

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

## 0.6.0 (2026-08-31)

### 🚀 Features

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.5.1 (2026-08-30)

### 🩹 Fixes

- Adopt the @yadsh scope, import the real plugin suite, and standardize monorepo build, validation, and release infrastructure. ([dce0a77](https://github.com/xarleyn/dsh-plugins/commit/dce0a77))

### ❤️ Thank You

- xarleyn @xarleyn