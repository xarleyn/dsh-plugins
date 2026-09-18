## 0.4.0 (2026-09-17)

### 🚀 Features

- Export the shared structural logging contract `PluginLoggerLike` and the ([146c89a](https://github.com/xarleyn/dsh-plugins/commit/146c89a))
  `silentPluginLogger()` stub from the package instead of per-plugin copies.

  Server plugins keep their services and tool factories on a narrow
  `debug`/`info`/`warn`/`error` surface so tests can inject a stub while the
  entrypoint binds the real logger; until now every plugin declared that
  contract (and its silent stand-in) in its own `src/logging.ts`. The contract
  now lives next to `PluginLogger`, which satisfies it structurally, so
  `dsh-cas-results`, `dsh-git-readonly` and `dsh-tool-offload` re-export the
  identical surface from this package.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.1 (2026-09-15)

### 🩹 Fixes

- Reformat the package with the repository's shared Prettier configuration. The ([ddba2dd](https://github.com/xarleyn/dsh-plugins/commit/ddba2dd))
  config now lives in the repository root instead of inside four packages, and
  this sweep brings every package to it. Formatting only — no behavior and no API
  change beyond the reformatted sources in the published tarball.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.3.0 (2026-09-13)

### 🚀 Features

- Publish every recorded line on a process-wide bus. `subscribePluginLogRecords` ([244b588](https://github.com/xarleyn/dsh-plugins/commit/244b588))
  hands a consumer each record as it is written — sequence, time, level, plugin,
  module, event, and the caller's own fields — so live views no longer have to
  read the log file back or keep a logger of their own. Only the level threshold
  decides what reaches the bus, so a consumer never sees output the logger
  considered suppressed, and a throwing listener cannot affect the logger. The
  file destination, the registry, and the console mirror are unchanged.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-06)

### 🩹 Fixes

- Prevent slot mutation while inference streams are active, validate llama.cpp ([f97114e](https://github.com/xarleyn/dsh-plugins/commit/f97114e))
  management responses, use the shared DSH home, make correction truncation
  Unicode-safe, bound miner retention and pending state, restore strict host
  type checking for session scope, pause UI polling in hidden tabs, and align
  published package metadata, compatibility declarations, and build lifecycle
  gates.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-08-31)

### 🚀 Features

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### ❤️ Thank You

- xarleyn @xarleyn