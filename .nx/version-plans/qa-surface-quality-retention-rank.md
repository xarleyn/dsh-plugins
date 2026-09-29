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
sorting: schema version 2 adds a `(kind, seq)` index. Four family-scoped reads
are what it serves — the cap's lookup of the row at its rank, the `MAX(seq)` a
write takes its place from, the reload of one family, and the ownership sweep's
read of a family it is emptying. The two counts that check a legacy import are
not among them — neither the emptiness test that runs before the import nor the
per-family arrival check after it — because neither sorts anything and both were
already answered from a covering index, so the new index only changed which one
they read. What a reader sees newest-first is assembled in memory, by lists that
sort on `createdAt`; the one statement that reads backwards through `seq` is the
rank lookup, so the index is not what gives readers their shape.

What the index removes is the sort, and it removes it from two of those reads —
the rank lookup and the replay. A re-judgement meets both: the write runs the
cut and the read that follows it replays the family, so what used to sort the
family once per write and once per read now walks it. It does not cover the
table: the reads that want nothing but `seq` — the rank lookup and `MAX(seq)` —
are answered from the index alone, whereas the replay and the sweep read `json`
too and still reach the row, so they get cheaper without becoming flat.
Measured on a feedback family planted to its 20 000-row cap — those four reads,
each bound the way the store binds it, median of 201 timed calls, SQLite 3.51.3
on node v24.15.0, JSON parsing left out — the rank lookup went from 7.0 ms to
0.35 ms and `MAX(seq)` from 2.9 ms to 0.02 ms, the replay from 14 ms to 7.6 ms
and the sweep from 9.0 ms to 7.9 ms. Of those, the first pair is the figure that
travels: read from the index alone, milliseconds becoming fractions of a
millisecond held on a second machine. The shares the replay and the sweep saved
moved between the runs taken here — the replay by between 45 % and 54 %, the
sweep by between 4 % and 12 % — so those last two say a direction, not a ratio.
What stays is the traversal: finding the rank walks as many index entries as the
cap, so the cap bounds it rather than a seek, but only through that family's
slice of the index, and the delete reaches just the rows it removes — a write
that does not overflow pays the read alone.

The tests fill the feedback family to its cap and re-judge one record, and do
the same to the review family, each time asserting the row count and which
record gave up its place both in the open store and after a reopen. Two more
fill the queue: one drops an entry from the middle and then pushes past the cap,
asserting in the open store, and one lets the ownership sweep forget three
conversations of a full queue before refilling it to the cap, through the reopen
as well. One more opens a file that schema version 1 wrote — rows, no index, and
the version number saying so — checks that the upgrade adds the index, then
re-judges a rating through it and reads the file back, so the step is proven on
the paths a write takes and not only by opening the table. Every other test
creates its file fresh and would only ever run that step on an empty table. A
last test reads the query plan of the four statements above, bound with the
arguments the store's own calls pass, so the index that bounds this cost is
checked rather than assumed: the rank lookup and the replay walk it instead of
sorting the family into a temp B-tree, and only the rank lookup and the
`MAX(seq)` read are answered from the index alone. Nothing is seeded there,
because a plan is compiled from the statement and the schema rather than from
how many rows a table holds, and the sweep is claimed no further than that it
sorts nothing — which of two same-cost indexes answers its bare
`WHERE kind = ?` is the planner's tie-break and not a property of the statement,
so what it saves is the measured direction above rather than a number asserted
here.
