---
"@yadsh/dsh-jev-compaction": minor
---
New plugin: Jev-powered, replay-safe semantic pruning of stale tool results. On `agent/pre-step` — at a configurable context pressure — historical `tool/result` surface nodes are scored by the Jev decision model and replaced through replay-safe single-node replacements (truncated head/tail or a neutral stub), while conversation text stays verbatim and the original full results remain in the append-only session log. Includes `/jev-compact` and `/jev-compact --dry-run` commands, automatic pressure triggering with cooldown and a minimum-savings gate, strict response validation with fail-open behavior, and a fake decision backend for tests.
