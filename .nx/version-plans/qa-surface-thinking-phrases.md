---
"@yadsh/dsh-qa-surface": minor
---

Make the running indicator's phrases configurable. The list a QA surface cycles
through while a turn runs was compiled into the browser bundle; it is now the
`thinkingPhrases` config field, so a deployment can speak its own vocabulary
instead of the shipped workshop imagery.

The work block's label and the composer hint read the same entry and advance it
together every four seconds, off the same turn start, so the two can no longer
disagree about what the surface is doing. The canonical default list moves out
of the client component into the shared config module, which keeps the schema,
the resolver and the browser on one list.

Like `suggestedQuestions`, the field drops blank and duplicate entries and caps
a phrase at 120 characters. Unlike quick questions, an empty list cannot hide
the control: an empty or absent list restores the built-in phrases, because the
indicator always needs a label.

The settings card's "Фразы ожидания" field shows the list that is actually in
effect — the stored list when there is one, otherwise the list the running Host
resolved, and the built-in list before the Remote answers — instead of an empty
box for a setting that is doing something. Typing in any list control now
survives a parent render: the draft follows the stored text rather than the
array identity, so a caller that renders an unset list from a literal default
no longer wipes the field on the next render.
