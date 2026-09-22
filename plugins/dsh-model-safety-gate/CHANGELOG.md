## 0.2.6 (2026-09-22)

### 🩹 Fixes

- One helper builds the gate the tests exercise. ([89470e0](https://github.com/xarleyn/dsh-plugins/commit/89470e0))

  Every gate test assembled its own stub of the surrounding host, which is how a
  test quietly stops testing the thing it names: the helper now builds the gate
  the same way for all of them, so a surface the plugin gains is exercised by the
  whole suite rather than by whichever test remembered to add it.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.5 (2026-09-22)

### 🩹 Fixes

- A disposed gate stays disposed, even when its services resolve late. ([a3294a6](https://github.com/xarleyn/dsh-plugins/commit/a3294a6))

  `ctx.inject` resolves whenever the service appears — and a service can appear
  while the host is tearing the plugin down. Both injections ignored that: the
  tool runtime's callback pushed its two listeners into a disposer list that had
  already been emptied, so a reload left a gate deciding behind a plugin that no
  longer existed, and the settings provider's callback installed a namespace whose
  card would edit a gate that was gone. The same shape sat in `reapply`: a
  committed settings change arriving after disposal rebuilt the pipeline and
  re-opened a logger that had already been closed.

  Disposal is now a one-way door: the tool injection, the settings installation
  and the configuration rebuild each answer a disposed service by doing nothing.

- `enabled: false` and `mode: off` now silence the whole gate, not three surfaces ([38a8214](https://github.com/xarleyn/dsh-plugins/commit/38a8214))
  out of four.

  The master switch and the `off` profile were honoured on the streaming-output
  surface alone. An off gate still scanned every user prompt, every tool call and
  every tool result, still ran the classifier when one was configured (one model
  request per prompt, since the input surface asks for a classifier call on every
  check), and still wrote its audit records — it only declined to act on what it
  found. A deployment that had turned the gate off paid the cost and kept the log
  of a running gate, and `mode: off` could still reject a prompt through the input
  surface, because the mode cap table did not know the value and passed a `block`
  straight through.

  Every surface now asks the same question — is this gate off? — before it does
  anything else, and returns the call untouched when it is. The input surface also
  honours its own `input.enabled` switch, which the schema accepted and the guard
  ignored, and a gate switched off at runtime through the settings card stops the
  very next check, without re-registering a listener.

- A blocked call no longer claims the user rejected it when nobody was asked. ([ce28d32](https://github.com/xarleyn/dsh-plugins/commit/ce28d32))

  The gate's tool-call guard escalates a call to `ask` when the turn's accumulated
  risk demands confirmation. That decision is not the gate's to keep: the tool
  runtime resolves it through the `approval` service, and the outcome vocabulary
  carries no reason — the runtime writes its own sentence, so a refusal reads
  `the user rejected tool "X"` and the categories the gate reported are dropped.
  On a session whose effective approval policy is `never` that is the only
  possible outcome, decided before any answerer runs.

  A locked-down deployment therefore turned every escalation into a phantom human
  refusal: the model learned that an operator said no, and never learned which
  rule fired. The gate now reads the same policy the approval service reads — the
  session's logged override first, else the deployment default — and refuses the
  call itself:

  ```text
  Blocked by dsh-model-safety-gate (unsafe_tool_intent): this call needs
  confirmation, but the session's approval policy is "never", so the request
  could only ever be refused without asking anyone
  ```

  Nothing about the outcome changes: under that policy the runtime's own answer
  was the same refusal, decided before any answerer could run. Only the sentence
  changes — it now attributes the refusal to the gate and keeps the categories.

  The read is deliberately narrow: only a policy the gate actually read can turn
  an ask into a refusal, so a host that composes no approval service, a session it
  cannot read, and a value outside the published vocabulary all keep the native
  ask. `tools.unanswerableAsk: ask` restores that flow for a deployment whose own
  gate answers asks ahead of the policy.

### ❤️ Thank You

- Codebuff
- xarleyn @xarleyn

## 0.2.4 (2026-09-21)

### 🩹 Fixes

- Internal cleanup: the output-stream quarantine integration test is split into a ([b342ea0](https://github.com/xarleyn/dsh-plugins/commit/b342ea0))
  domain file with shared helpers. No runtime behavior changed.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.3 (2026-09-17)

### 🩹 Fixes

- Internal cleanup: package verification gates now run through the shared `@yadsh/dsh-plugin-scripts` runner (added as a devDependency). No runtime behavior changed. ([c8b9d2f](https://github.com/xarleyn/dsh-plugins/commit/c8b9d2f))

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.4.0
- Updated @yadsh/dsh-plugin-kit to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.2 (2026-09-15)

### 🩹 Fixes

- Keep plugin-specific records out of Harness session journals so sessions remain ([82d5890](https://github.com/xarleyn/dsh-plugins/commit/82d5890))
  readable after a DSH restart even when linked packages resolve separate module
  instances. Safety audit records now use the plugin logger with explicit session
  ids, QA source snapshots use plugin-owned durable storage, and the QA package
  ships a dry-run-first repair command for legacy journals with automatic backups.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-14)

### 🩹 Fixes

- Keep tool-call checks strictly observational in audit mode. Findings are still ([d50922f](https://github.com/xarleyn/dsh-plugins/commit/d50922f))
  scanned and recorded, but accumulated turn risk can no longer turn an audited
  tool call into an approval request or denial.

### ❤️ Thank You

- xarleyn @xarleyn

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