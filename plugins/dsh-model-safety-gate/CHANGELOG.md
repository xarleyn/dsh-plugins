## 0.2.0 (2026-09-13)

### 🚀 Features

- Add the operator surface the gate was missing: a settings card under ([dc86bcf](https://github.com/xarleyn/dsh-plugins/commit/dc86bcf))
  `Settings → Plugins → Plugin configuration`. The plugin now owns the live
  `model-safety-gate` settings namespace, so the card's sections — gate, input,
  output stream, tools and results, classifier, audit, and advanced patterns —
  re-resolve the running gate on the spot instead of requiring a restart, and a
  value the gate could not act on (a `dsh` classifier backend without a provider,
  an uncompilable custom pattern) is refused when it is written rather than
  stored and ignored.

  The card also reports what the gate is actually doing through the `safetyGate`
  Typert Remote: the effective mode, whether the classifier is genuinely wired,
  the process counters, and the last 50 sanitized verdicts. The classifier key is
  declared a secret slot and never returned to a browser, and the card states in
  place that an OpenAI-compatible classifier sends prompts, output, and reasoning
  to the endpoint it names.

  Configuration changes are live from either side. `ModelSafetyGate` now reads
  its configuration, pipeline, and scanner through a stable guard handle, so a
  committed settings write swaps the policy behind listeners the host already
  holds. `classifier.apiKey` is a `role("secret")` field; the internal audit
  record now carries only declared error codes.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

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