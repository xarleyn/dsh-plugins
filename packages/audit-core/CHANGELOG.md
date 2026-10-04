## 0.1.1 (2026-10-04)

### 🩹 Fixes

- Every publishable library under packages/ now carries a gate of its own. ([#293](https://github.com/xarleyn/dsh-plugins/issues/293))

  Each of the four gained a `verify` target that holds the promises packing cannot
  check: `main` and `types` name the same file as the root export, every declared
  subpath is built, and every published dependency range resolves for a consumer
  that installs from the registry — a `workspace:` range never names a private or
  missing member, a `catalog:` range never names a member at all, and a member is
  never declared as a plain range. `README.md` and `LICENSE` are pinned on disk,
  because the tarball gate that asks for them by name covers plugins only. The
  package hygiene gate requires the target to stay and reads the call itself, so a
  library that loses its gate — or keeps the script while dropping one of the two
  checks — fails locally and in CI instead of shipping unchecked.

### ❤️ Thank You

- qoder-bot

## 0.1.0 (2026-09-18)

### 🚀 Features

- Initial release: the session audit artifact domain. ([c158821](https://github.com/xarleyn/dsh-plugins/commit/c158821))

  An audit is two files — `analysis.json` (the semantic source) and `REPORT.md`
  (the human-readable one) — kept together in one directory. This package is the
  single definition of what those files mean, shared by everything that produces
  them and everything that displays them, so a producer and a viewer can no
  longer disagree about what a field is called.

  It is deliberately not a plugin and depends on nothing: no Cordis, no React, no
  DOM. The main entry is safe in a browser bundle; the only module that touches
  the filesystem is behind `./producer`, and the only one that needs `node:path`
  is behind `./paths`.

  Two rules shape every reader. A malformed artefact never throws — wrong types
  are dropped field by field, and a truncated or hand-edited audit still renders
  what it has. And a future `schemaVersion` is not an error: it parses to an
  unknown-schema value with an `UNSUPPORTED_SCHEMA` warning, so the report and the
  raw document stay readable while the semantic view waits for a newer build.

  The producer half writes an audit the way the watcher wants to find it: stage
  both files inside the audit root, flush them, then move the directory into
  place with one rename. A reader watching the root never observes a half-copied
  audit, which is why the settle window matters only for producers that write
  their own files. A re-audit of the same session publishes beside the previous
  one rather than over it — an audit is a durable artefact, and destroying one is
  not a library's decision to make.

### ❤️ Thank You

- xarleyn @xarleyn