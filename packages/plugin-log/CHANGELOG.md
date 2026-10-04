## 0.4.1 (2026-10-04)

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

- A `redact` path hides the field from the console mirror and the live log panel, ([#341](https://github.com/xarleyn/dsh-plugins/issues/341))
  not only from the log file; the logger stops freezing the caller's object, and
  retention sweeps on every rollover instead of once per logger.

  Redaction used to be a property of the pino instance alone, so it guarded the one
  sink that serializes through pino. The console mirror printed the fields as they
  arrived, and the record bus published them to the log panel the same way — a
  plugin that configured `redact: ["apiKey"]` kept its key out of `<day>.log` while
  the operator's terminal and the **Plugin logs** sidebar both showed it. The
  bus was documented as raw, and the panel was documented as the place where
  sanitizing happens, but the panel only bounds what it renders: depth, cycles,
  length. Nothing between the logger and the screen was ever asked to cut a secret.
  The paths now run once in `write`, through the same `@pinojs/redact` pino uses,
  before the sinks branch: a record the level keeps out of the file is redacted on
  its way to the mirror too, and a record whose fields throw when read — a getter, a
  Proxy — is dropped rather than handed out unredacted, since reading them is the
  caller's own code. The paths address the fields object; pino keeps its own pass,
  which is what additionally covers the `msg`, `plugin` and `module` keys of its line.

  A published record also used to freeze the object it was handed, so a plugin that
  logged a field object it still owned got a `TypeError` on its next assignment. The
  record now carries a frozen top-level copy instead, so the caller keeps writing to
  its own object while the keys a subscriber was given stay put. Nested values remain
  the caller's objects: a record is not a deep snapshot, and only a value a `redact`
  path cloned is cut off from the caller for good.

  Retention ran only once for the life of a logger: the sweep promise was kept
  forever as the guard against overlapping passes, and every later rollover saw it
  still set and skipped its own. On a long-running host the window therefore
  stopped being enforced the day after startup, and daily logs kept accumulating
  however short `retentionDays` was. Sweeps are now chained behind one another —
  still never overlapping, still awaited by `close()` — so each rollover prunes the
  files the window covers.

### ❤️ Thank You

- qoder-bot

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