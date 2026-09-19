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
