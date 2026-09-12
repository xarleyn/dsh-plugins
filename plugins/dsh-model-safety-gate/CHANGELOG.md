## 0.1.1 (2026-09-12)

### 🩹 Fixes

- Retest against the DSH 0.1.5-rc.2 baseline with no code changes; the ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  compatibility contract and README requirements move to
  `>=0.1.5-rc.2 <0.2.0`.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.0 (2026-09-10)

### 🚀 Features

- Add the two-layer safety gate: a deterministic L0 scanner plus an isolated ([96ec692](https://github.com/xarleyn/dsh-plugins/commit/96ec692))
  small-model L1 classifier now evaluate user prompts (`agent/pre-step`),
  streamed text and reasoning (`llm/stream` with buffered quarantine, rolling
  windows, and provider cancellation), tool calls (`tools/pre-execute` with
  native allow/ask/deny), and tool results (`tools/post-execute` feeding a
  per-turn risk state). Includes the strict verdict schema, classifier backends
  for a DSH provider/model pair or an OpenAI-compatible endpoint, timeout and
  failure modes (`closed` / `open` / `rules-only` / `ask`), monotonic safety
  merging that cannot be weakened by the model verdict, sanitized session-event
  audit with content hashes only by default, and safety counters.

### ❤️ Thank You

- xarleyn @xarleyn