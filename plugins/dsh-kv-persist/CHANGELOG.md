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