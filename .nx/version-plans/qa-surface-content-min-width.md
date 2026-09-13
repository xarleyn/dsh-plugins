---
"@yadsh/dsh-qa-surface": minor
---

Flip the QA transcript width bound from a cap to a floor. The surface used to
carry an operator-set `ui.maxContentWidth` that no drag could pass, so a QA
deployment with a wide screen left the transcript boxed in at 900px. The
setting is now `ui.minContentWidth` (default 650): the drag handles narrow the
transcript no further than that, and apart from it the page is the only
ceiling — the content keeps widening until its handles reach the edge budget,
which is how the DSH conversation column itself is bounded. A window too narrow
to hold the floor wins over the floor, because there is no other space to take
and the handles have to stay reachable.

The width a browser persists is still clamped before it is written, so a stored
preference from the capped era resolves against the new bounds instead of
surviving as an out-of-range value. Deployments that still carry
`maxContentWidth` keep working on the shipped default: the removed key is not
part of the schema and is ignored, and the settings card's field is relabelled
"Минимальная ширина содержимого, px".
