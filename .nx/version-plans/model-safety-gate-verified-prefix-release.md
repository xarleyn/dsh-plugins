---
"@yadsh/dsh-model-safety-gate": patch
---

Buffered output releases only what a check has actually examined, and the gate
profile now decides on every surface.

The streaming quarantine sized each classifier snapshot from the newest end of
the buffer and then released all of it. A chunk wider than `output.windowChars`
was therefore shipped on the strength of its tail: the oldest quarantined text
never once reached a scan, yet reached the consumer — and the same gap opened
whenever `output.minCheckIntervalMs` let several chunks pile up behind one check.
A window now fills from the oldest quarantined text, and a flush hands back no
further than the head the passing check covered, so a buffer larger than one
window drains window by window. The released prefix stays in front of the next
window as its context, so nothing slips through the seam between two.

The output guard read the pipeline's raw decision while the input, tool-call and
tool-result guards all capped theirs through the shared mode mapping, so a gate
set to `audit` — the profile that records findings without acting on them —
cancelled the turn and withheld text, and `warn` blocked exactly like `enforce`.
Streamed output now answers the same question as every other surface: `audit`
records and releases, `warn` reports without withholding, and only `enforce`
stops a generation.
