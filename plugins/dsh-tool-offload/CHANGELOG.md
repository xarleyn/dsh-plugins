## 0.1.1 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  compatibility contract and README requirements move to
  `>=0.1.5-rc.2 <0.2.0`.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-10)

### 🚀 Features

- Initial release: large successful textual tool results (read, grep/search, ([0c0feec](https://github.com/xarleyn/dsh-plugins/commit/0c0feec))
  web_fetch by default, ≥ 24 KB or ≥ 6 000 estimated tokens) are processed by a
  cheap one-shot no-tools worker started through `ctx.subagents`, and only the
  model-facing content is replaced with the worker's compact, validated answer.
  Deterministic allowlist/denylist routing with ordered rules, bounded parent
  context behind injection-safe prompt boundaries, worker timeout and parent
  cancellation, non-blocking per-agent/global concurrency budgets, bundled and
  custom prompt profiles, `original`/`truncate`/`error` fallbacks, recursion
  guards, and structured telemetry with reduction metrics.

### ❤️ Thank You

- xarleyn @xarleyn