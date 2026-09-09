---
"@yadsh/dsh-model-safety-gate": minor
---

Add the two-layer safety gate: a deterministic L0 scanner plus an isolated
small-model L1 classifier now evaluate user prompts (`agent/pre-step`),
streamed text and reasoning (`llm/stream` with buffered quarantine, rolling
windows, and provider cancellation), tool calls (`tools/pre-execute` with
native allow/ask/deny), and tool results (`tools/post-execute` feeding a
per-turn risk state). Includes the strict verdict schema, classifier backends
for a DSH provider/model pair or an OpenAI-compatible endpoint, timeout and
failure modes (`closed` / `open` / `rules-only` / `ask`), monotonic safety
merging that cannot be weakened by the model verdict, sanitized session-event
audit with content hashes only by default, and safety counters.
