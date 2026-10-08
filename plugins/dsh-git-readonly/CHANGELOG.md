## 0.2.5 (2026-10-08)

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

- xarleyn @xarleyn

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

- The plugin's own git suites finish on a loaded Windows run instead of timing out ([#290](https://github.com/xarleyn/dsh-plugins/issues/290))
  before their first assertion, and they no longer inherit the identity of
  whoever runs them.

  Every git suite builds a throwaway repository in `beforeAll` — the mutation
  suite builds two, and a single repository costs seven `git` calls before it
  holds one commit — and the snapshot tests then walk the repository they built.
  Vitest gives a hook ten seconds and a test five, and this package re-exported
  the shared preset with no override, so a full `nx run-many -t test` on Windows
  lost suites to `Hook timed out in 10000ms`. Vitest marks the tests of such a
  file skipped while counting the file itself as failed, which is how the 22.09
  full-run slice read as six failures.

  It is the load that the budgets could not cover, not the git work: process
  creation and file I/O get expensive enough that the heaviest snapshot test costs
  a second on an idle machine and measured 52s inside a full run, and the two
  heaviest files reached 139s and 103s. The package now budgets 120s per test and
  90s per hook, and runs its suites on two Vitest workers rather than one per
  logical CPU. Every worker builds its repositories with real `git` children, so
  the suite was inflating the load it then failed to meet, and a `git` child that
  comes back non-zero without a word is not a thing any budget forgives.

  The ceiling therefore sits on the child rather than on the budget: each fixture
  `git` run is killed at twenty seconds and reports which command it was. A hang
  then costs one named command instead of a whole test budget, which is what makes
  the two numbers above headroom over a measured slow run rather than a place for
  a hang to idle. A loaded run is not a Windows-only case either — the per-project
  split the pipeline fans out with has collapsed into a single job running every
  project on one runner, and five other suites timed out inside it while this one
  finished.

  The throwaway repositories were also not hermetic. `GIT_AUTHOR_*` and
  `GIT_COMMITTER_*` outrank both the `user.name` the fixture writes into the
  repository and the per-commit `-c user.name=` override, so a caller that
  exports its own identity — a CI bot, an agent harness — silently became the
  author of every fixture commit, and the blame, context and history assertions
  failed on that name. The fixture now strips those six keys from the environment
  of every `git` it starts, so the identity it pins in repository config is the
  identity commits carry.

  A third failure the same runs exposed was not a timeout at all: one of the
  fixture's setup `git` calls came back failed with nothing on stderr, which
  dropped its whole test file and left those tests reported skipped. git writes a
  diagnosis whenever it chooses to refuse, so silence means the child died before
  refusing anything. The fixture now reports the exit code and signal it used to
  discard, and retries a setup command only on that silence — up to three more
  attempts with a short backoff. Commands past setup keep failing on their first
  error, because a retried commit would leave two commits where the snapshot
  compares against one.

  No runtime behavior changed: these fixes live in test configuration and test
  fixtures.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.1

### ❤️ Thank You

- qoder-bot

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: the plugin consumes the shared `PluginLoggerLike` contract from `@yadsh/dsh-plugin-log` instead of a private copy, and its package verification gates run through the shared runner. No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-16)

### 🩹 Fixes

- Read a selection of the session directory itself as no selection, and say so ([80c5455](https://github.com/xarleyn/dsh-plugins/commit/80c5455))
  when an instance has no repository roots at all. A QA session pinned to a
  scratch directory that is not a repository — the per-user workspace layout —
  now inspects the configured `repositoryRoots` entry instead of refusing when
  the model names its own cwd as the repository; the refusal for any other
  directory that holds no repository names the configured roots, and a refusal
  with none says `this row exposes no repository roots`, which is how a
  preset-mounted instance missing its own configuration is recognized.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-09-14)

### 🚀 Features

- Allow every provenance tool to inspect an explicitly selected repository ([4e10a3d](https://github.com/xarleyn/dsh-plugins/commit/4e10a3d))
  without turning the selector into a filesystem escape. The new `repository`
  argument resolves relative to the session cwd and is accepted only when both
  that directory and Git's resolved work-tree root remain inside the session cwd
  or an operator-configured `repositoryRoots` entry. Calls without the argument
  use the session repository first and fall back to the only configured root;
  multiple roots require an explicit choice. Denied or invalid selections carry
  stable typed errors with a recovery hint.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-13)

### 🩹 Fixes

- Make the read-only guarantee reproducible in CI. The mutation suite snapshots ([03cceac](https://github.com/xarleyn/dsh-plugins/commit/03cceac))
  a throwaway repository before and after every tool call, and `git commit` in
  that fixture ends by spawning a detached `git maintenance run --auto` that
  holds `.git/objects/maintenance.lock` until it exits. On a loaded Linux runner
  the daemon outlived the commit, so the lock landed inside one snapshot but not
  the other and the suite failed over a file no tool wrote. The fixture now
  pins its repositories against auto-maintenance, snapshots compare file by file
  so a failure names the paths that changed, and directory walks no longer
  depend on readdir order.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-12)

### 🚀 Features

- Initial release: four read-only git provenance tools (`dsh_git_context`, ([1927a62](https://github.com/xarleyn/dsh-plugins/commit/1927a62))
  `dsh_git_history`, `dsh_git_show`, `dsh_git_blame`) that let an agent answer
  "what task was this changed for" against the session repository without ever
  receiving a command line. The model passes structured parameters only —
  hexadecimal commit ids, repository-relative paths after `--`, bounded literal
  search strings; the plugin builds and spawns the git argv itself, hardened
  against repo-controlled config (`diff.external`, textconv, `core.fsmonitor`
  are disabled and proven never to execute) and against a poisoned ambient
  environment (git redirection and config keys stripped, deterministic values
  forced). Fail-closed session/repository resolution, byte-capped and
  time-boxed subprocesses with explicit truncation flags, structured bounded
  output, typed error codes, and a mutation test suite asserting the
  repository stays byte-identical across every tool call.

### ❤️ Thank You

- xarleyn @xarleyn