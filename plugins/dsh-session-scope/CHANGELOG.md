## 0.7.6 (2026-10-04)

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

- The browser client is several modules now, and nothing the shell sees changes. ([#317](https://github.com/xarleyn/dsh-plugins/issues/317))

  `src/client.ts` was one 1429-line file holding everything the client renders and
  all of the transport it uses. It is now a `src/client/` directory built by the
  same tsdown entry: `index.ts` keeps what only a mounted plugin instance can own —
  the Remote `$mount`, the durable `/scope` write, the read RPC, the composer seat
  and the blank-session hero portal — while the copy, the stylesheet, the icons,
  the path-comparison rules and the client half of the Remote contract each got
  their own module, and the scope editor was separated into the draft state and
  commands (`scope-editor.ts`) and the rendering of the modal
  (`scope-editor-view.ts`). The largest client module is 400 lines.

  Nothing observable moved. The bundle is still generated rather than authored,
  still registers exactly `@yadsh/dsh-session-scope`, still takes `react` and
  `react-dom` as shell statics, still contributes the Scope chip to the composer's
  left seat, still resolves the workspace root from the sessions store and falls
  back to the `session-scope` projection, and still reads one directory level
  through the dedicated non-durable `sessionScope/list` RPC instead of a slash
  command. `verify:client` asserts those shapes in the built artifact and runs the
  registration against a module-loader stub, and the client tests still mount the
  chip through a fake React; every string the client renders survived the move
  verbatim.

  Two boundaries became explicit instead of implicit. The editor no longer closes
  over the transport — it is handed `runCommand` and `listLevel` as props, so what
  a draft is saved through is visible where the editor starts. And clearing every
  pending row is a named action of the editor rather than a raw state patch
  written in the middle of the render tree, which is the one place the render had
  been reaching into state.

- The isolated Linux backend now hides the workspace from itself. ([#359](https://github.com/xarleyn/dsh-plugins/issues/359))

  `isolated` masked the session workspace with mounts: the selected roots are
  staged, the workspace is covered with an empty tmpfs, and the chosen roots are
  bound back over it. That leaves the mount path as the only thing doing the
  hiding. While the confined process shared a PID namespace with the host, every
  unconfined process of the same UID stayed addressable inside the sandbox as
  `/proc/<pid>` — and `/proc/<pid>/root` is that process's own root, so it is a
  second path to the very workspace the tmpfs just covered. Whether a same-UID
  reader may actually resolve the link is decided by Yama, `hidepid=` and the
  target's dumpability, which means the guarantee the plugin advertises was being
  granted by whichever host it happened to run on rather than by the sandbox.

  The isolated profile therefore takes a PID namespace of its own: the rewritten
  argv carries `--unshare-pid` alongside the provider's `--proc /proc`, so the
  mounted procfs belongs to the new namespace and the confined process meets no
  outside pid at all. The route is gone on every host, not only on strict ones.
  Both isolated shapes get it — the narrowed view and the whole-workspace
  selection — and the capability probe runs exactly this argv, so a kernel that
  cannot create the namespace reports `isolated` as unavailable and fails closed
  instead of promising a weaker isolation than the mode means. The recognized
  provider profile is untouched: what has to match the host's own bwrap output is
  the input, and the plugin still owns only the narrowing.

  A fixture holds the line where the claim is made. Under bwrap it runs the same
  probe twice — once in the provider's profile, once in the isolated one — against
  an unconfined bystander of the same UID: the confined process must share the
  host's PID namespace and be able to name the bystander by its argv in the first
  run, and must be in a different namespace and unable to name it in the second,
  with the hidden file unreachable and the selected file still readable. The
  comparison is deliberately about the namespace and the addressability, not about
  whether the bystander's proc-root read succeeds: that answer is the host's
  policy, and a test asserting it would pass or fail for reasons this package does
  control nothing of.

  What `isolated` still does not promise is unchanged: a `read-only` permission
  mode keeps the rest of the host filesystem visible, processes outside the
  sandbox are not restricted by it, and memory of the confined process is readable
  by whoever could read it before confinement.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

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