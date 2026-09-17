---
"@yadsh/dsh-documents": minor
---

Compare two revisions of a document without leaving the plugin.

`document_compare` reads both sides itself — DOCX through its own OOXML reader,
Markdown and plain text natively, PDF through the deployment's extraction
backend — and answers with a comparison artifact, a change summary, the
extraction quality and a short preview. `document_diff_read` pages through the
change set with filters by section, kind and signal, so a hundred-page contract
never arrives as one tool result.

The diff, not the model, decides what changed: structural alignment (patience
anchors, then similarity pairing) followed by a token diff over the exact text,
with moves, table cells and tracked revisions handled as themselves. Every
change carries a stable id, a location, the text before and after, and the
deterministic signals the text supports — numbers, amounts, percentages, dates,
durations, negations, party references, and obligation/permission/prohibition
vocabulary. Risk is not reported: interpreting the change set is the model's
half of the split, and the shipped `contract-review` skill states the rule that
a difference without a `changeId` does not exist.

A comparison is an artifact like any other (`cmp_<ULID>`, same root, same
retention) holding the inputs, the canonical IR of each side, `changes.jsonl`,
a model-free `report.md` and a manifest that makes the run reproducible.
Comparison runs in-process: no shell, no sockets, no converter between two
revisions, and its budgets (input bytes, nodes, uncompressed container bytes,
changes, wall-clock time) are configuration. `documents.comparison.enabled:
false` leaves both tools unregistered and the skill unmounted.
