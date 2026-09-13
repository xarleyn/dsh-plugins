---
"@yadsh/dsh-model-safety-gate": minor
---

Add the operator surface the gate was missing: a settings card under
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
