---
"@yadsh/dsh-qa-surface": patch
---

A full quality family keeps every record when one of them is re-judged.

Retention cuts each family of `quality_rows` down to its cap, and the cut was
expressed as a range of `seq`: drop everything below `MAX(seq) - cap`. That
arithmetic equals the overflow only while every sequence value between the
oldest row and the newest one is taken, and the store itself vacates values.
Re-rating a message moves that row to the end of its family's order and leaves
its old value behind; dropping a conversation or a queue entry leaves a hole the
same way. Every vacated value therefore cost one real record. A family at its
cap lost its oldest row to a re-judgement of a record it already held — 20 000
ratings came back as 19 999 — with nothing new arriving to displace anything.
The in-memory list is trimmed by row count, so the loss stayed invisible until
the next open of the file replaced the list with the smaller database.

The cut now ranks instead of measuring: a family keeps the newest `cap` rows by
`seq` and gives up what falls below that rank, so re-judging what the store
already holds costs nothing, while a genuine overflow still costs exactly its
oldest entry. The tests fill the feedback family to its cap and re-judge one
record, and fill the queue, drop an entry from its middle and then push past the
cap — asserting the row count and which record gave up its place, both in the
open store and after a reopen.
