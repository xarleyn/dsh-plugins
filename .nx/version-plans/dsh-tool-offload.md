---
"@yadsh/dsh-tool-offload": minor
---

Initial release: large successful textual tool results (read, grep/search,
web_fetch by default, ≥ 24 KB or ≥ 6 000 estimated tokens) are processed by a
cheap one-shot no-tools worker started through `ctx.subagents`, and only the
model-facing content is replaced with the worker's compact, validated answer.
Deterministic allowlist/denylist routing with ordered rules, bounded parent
context behind injection-safe prompt boundaries, worker timeout and parent
cancellation, non-blocking per-agent/global concurrency budgets, bundled and
custom prompt profiles, `original`/`truncate`/`error` fallbacks, recursion
guards, and structured telemetry with reduction metrics.
