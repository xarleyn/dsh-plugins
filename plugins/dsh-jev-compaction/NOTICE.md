# NOTICE

## Attribution

Inspired by fast-jev-compaction by Tamara Tran:
https://github.com/tamaratran/fast-jev-compaction

The original project introduced the Jev-based selective tool-history
compaction approach for Claude Code. `@yadsh/dsh-jev-compaction` adapts that
idea to DeepSeek Harness' append-only session log and replayable surface
model.

The Jev wire contract used by this plugin follows the upstream project's
System One client: one `POST` to the configured endpoint with
`{ model, state, questions }`, `Authorization: Bearer <API key from the
configured environment variable>`, and answers keyed by question name, each
carrying a `noul` probability. The state representation, the planner, the
safety policy, and the surface mutation layer are independent
implementations for the DeepSeek Harness session architecture; no upstream
code is copied.

fast-jev-compaction is licensed MIT (Copyright (c) 2025 Tamara Tran).

## Immediate result shaping

The immediate result-shaping layer (the `tools/post-execute` shaper) was
inspired by the `typesafe-result-shaper` module of
[zhangxaochen/dsh-jev](https://github.com/zhangxaochen/dsh-jev), which
introduced line-shape clustering of command output for a Jev-based decision.

This implementation is adapted for this plugin's two-stage context lifecycle
and its reversible/archive safety model: conclusions, failures and diagnostics
are pinned before any classification, only contiguous same-shape runs may
collapse, two decisively-apart answers are required before anything is
dropped, and the original is archived before a shaped result is persisted. The
state representation, the question set, the retention policy and the archive
are independent implementations; no upstream code is copied.

dsh-jev is licensed MIT.
