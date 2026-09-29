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
oldest entry. The cut runs on every write and the feedback family grows to
20 000 rows, so finding the rank reads through an index instead of scanning and
sorting: schema version 2 adds a `(kind, seq)` index. Every family-scoped read
in the store walks it — the cap's lookup of the row at its rank, the `MAX(seq)`
a write takes its place from, the reload of one family, the ownership sweep's
read of a family it is emptying, and the row count that verifies a legacy
import, which runs once. The newest-first shape a reader sees is built in
memory, so no SQL here orders newest-first and the index is not what gives it.

What the index removes is the sort, and it removes it from two of those reads —
the rank lookup and the replay. A re-judgement meets both: the write runs the
cut and the read that follows it replays the family, so what used to sort the
family once per write and once per read now walks it. It does not cover the
table: the reads that want nothing but `seq` — the rank lookup, `MAX(seq)` and
that count — are answered from the index alone, whereas the replay and the sweep
read `json` too and still reach the row, so they get cheaper without becoming
flat. Measured locally on a family filled to its cap, the rank lookup and the
replay stopped building a temp B-tree, the rank lookup and the `MAX(seq)` read
fell from milliseconds to fractions of a millisecond, a replay cost about a fifth
less, and a sweep read under a tenth. What stays is the traversal: finding the
rank walks as many index entries as the cap, so the cap bounds it rather than a
seek, but only through that family's slice of the index, and the delete reaches
just the rows it removes — a write that does not overflow pays the read alone.

The tests fill the feedback family to its cap and re-judge one record, and do
the same to the review family, each time asserting the row count and which
record gave up its place both in the open store and after a reopen. Two more
fill the queue: one drops an entry from the middle and then pushes past the cap,
asserting in the open store, and one lets the ownership sweep forget three
conversations of a full queue before refilling it to the cap, through the reopen
as well. A last test reads the query plan of the four statements that read a
whole family or its end, against a feedback family seeded to its cap and with
the offset the cap really passes, so the index that bounds this cost is checked
rather than assumed: each of the four walks it, none of them sorts the family,
and only the rank lookup and the `MAX(seq)` read are answered from the index
alone.
