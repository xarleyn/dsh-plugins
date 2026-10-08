---
"@yadsh/dsh-qa-surface": patch
---

The source list explains an empty result instead of hiding the control that
would show it.

A turn that answers from recalled memory, or from what this chat already said,
adds nothing to the source list. No extractor in the provenance registry
recognises a memory read, and the deployment notes name recalled memory as the
background an answer is written against rather than as one of its origins, so an
empty list after such a turn is the design working, not a collection that broke.
The interface said nothing either way: no chip appeared under the answer, and the
header's "Sources" control stayed disabled — no counter, no reason — which also
sealed the one surface that could have explained the emptiness.

The control is no longer gated on a non-zero count, so a deployment that shows it
keeps it clickable, and the panel answers an empty settled list by naming the kind
of material the list holds and saying that an empty list is not a failed
collection. That sentence is drawn only once the collection has settled: a turn
still running and a delegated run that still owes its origins already say so on
the line above, and two contradictory texts on one screen read worse than none.

`README.md` §Sources, `SPEC.md` §46.2 and
`docs/specs/sources-provenance.md` §20.1 now carry the definition itself: both
channels that write the list — matched tool results and the report the answering
agent files through `qa_report_sources` — and why a bridged memory read reaches
neither.

Covered by `tests/provenance/provenance.test.ts` (a memory read yields no
source), `tests/client/components/qa-sources-panel.test.tsx` (an empty settled
list explains itself, an unsettled one stays silent) and
`tests/client/components/qa-header-layout.test.tsx` (the control is clickable on
a completed chat that has no sources).
