---
"@yadsh/dsh-qa-surface": patch
---

A turn a person stopped is reported as stopped, not as ready.

The work group closed a stopped turn with «Готово за 2 с» over an empty answer:
no notice over the fragment, and — because a turn stopped before its first
sentence commits no text row at all — no actions either. «Готово» claims a
complete answer, so the surface contradicted the click the reader had just made.
The surface already separates a provider failure, which has both a status of its
own and a row naming the code, so a human-stopped turn was the one turn outcome
left unreported.

The Host marks the difference. `AssistantMessageNode.interrupted` is set on the
message committed after a cancel, and on the prefix the Host assembles from the
streaming chunks when nothing was committed — that fallback is built at the
closed step boundary and is allowed without any prose as soon as reasoning or a
tool call counts as evidence (`dsh-client-ui-chat` `finalNode`). The projection
read `blocks`, `seq` and `timing` only, so a stopped turn carried no failure code
and settled into `complete`.

`QaTranscriptAdapter` now seats the flag on its turn and gives the turn a third
terminal status, `stopped`, which the work group prints as «Остановлено на N с»
and collapses the way it collapses a finished or failed turn, beside a notice row
that says the answer is incomplete and how to get the whole of it. A provider
failure still wins: a turn that stopped into a recorded `turn-error` keeps the
failure's own row rather than gaining a second banner. The text that did arrive
stays a committed answer row, so copy and rating stay reachable over a fragment —
stopping a turn to reword the question no longer eats what was written. A prefix
with no prose in it still gets the notice, which is the case that used to close
silently.

Covered by `tests/transcript/transcript-projection-stopped.test.ts` (both the
durable prefix and the chunk-only fallback read as stopped; the prefix keeps its
committed text row and the notice follows it; an unsettled variant of the same
fixture still reads `complete`; a failure suppresses the notice) and
`tests/client/components/qa-work-group.test.tsx` (the stopped label and the
automatic collapse off a running turn).
