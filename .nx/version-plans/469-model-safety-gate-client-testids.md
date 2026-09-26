---
"@yadsh/dsh-model-safety-gate": patch
---

The Safety Gate settings card is now addressable by a stable hook.

Every section of the card — Gate, Input guard, Output stream, Tools and results,
Classifier, Audit, Advanced, and the read-only Status and Recent verdicts views —
carries a `data-testid`, as do its toggles, selects, inputs and textareas, the
per-section reset, the status chips and counters, the banner of each state the
card reports, and the cells of a verdict row. The ids are ASCII kebab-case under
the `safety-` zone (`safety-gate-mode`, `safety-classifier-notice-remote`,
`safety-audit-notice-raw-content`, `safety-gate-session-override`), 92 distinct
values, none reused by a second kind of node. A state gets its own id rather
than a shared one whose text differs, and a repeated node — a verdict row, a
counter tile — holds the id of its template, so no row index or caption is baked
into a name. A browser check can now reach a control without reading its English
label, the class of a banner, or a walk up to the enclosing `<section>`.

Only attributes were added: the markup, the card shell and the rendered text are
unchanged. The card's own suite finds its nodes by id now, and every assertion
that was about a role or an accessible name stayed in place.
