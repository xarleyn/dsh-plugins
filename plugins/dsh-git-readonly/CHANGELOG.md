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