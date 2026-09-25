---
"@yadsh/dsh-doc-impact": patch
---

`changeDetection.maxSnapshotFiles` bounds the reading a snapshot does, not only
the report it prints.

The limit was applied to the list of dirty paths after every one of them had
already been read and hashed, so a turn in a workspace with a large dirty tree
paid for the whole tree while the card reported a capped, degraded snapshot.
The cap now stops the work: paths are read in the sorted order the report
already used and reading stops at the limit, which makes a degraded snapshot
the same bounded prefix across the two captures of a turn instead of a full
read followed by a different trimmed list.

Resetting a text or number field in the settings card drops the override
instead of writing the current base into it.

Reset staged the value the field would fall back to, and Save committed that
value as a user override. The card showed a reset field while the layer behind
it kept a new override: a later change to the composition base — the entry
config or the value the host declares — no longer reached the field, because
the number the reset had just written kept winning. Reset now means one thing
for every field kind, templates and selects included: the user layer loses the
key and the field follows the base again.
