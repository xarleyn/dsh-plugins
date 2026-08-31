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