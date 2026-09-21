---
"@yadsh/dsh-model-safety-gate": patch
---

`enabled: false` and `mode: off` now silence the whole gate, not three surfaces
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
