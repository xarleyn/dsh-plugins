---
"@yadsh/dsh-domain-experts": minor
---

An expert's memory can live in a database of its own instead of a rewritten document.

The carrier was never the problem at three domains and a handful of notes. It
became one on a working stand: 30 memory records, 103 KB of JSON, a doubling in
24 hours, and every `remember` re-serialising and replacing the whole unit —
because that is what the storage backend does with a snapshot it holds in memory.
A measured 5 000-record table costs 14.8 ms per write against 0.05 ms for the row
the same write is in SQLite, and clearing a namespace costs one delete per record
rather than one statement.

So the plugin gained a second memory provider, `sqlite`, chosen in deployment the
same way the subagent provider is: `defaultMemoryProvider: sqlite`, with
`memoryDbPath` naming the file (`<DSH_HOME>/domain-experts-memory.db` by
default). It is built on the repository's own SQLite plumbing, so it inherits WAL,
`BEGIN IMMEDIATE`, the schema version and the refusal to open a database a newer
build wrote — the same ground `qa-accounts.db` and `qa-quality.db` already stand
on. Namespaces and keys became columns, so a record of one domain can no longer
be addressed through a crafted key of another.

The switch is the part an operator will not notice, and that is the requirement:
memory that had already been written is still there, and it answers the same way.
The first time a `sqlite` deployment opens its storage, it copies what the unit
holds in one transaction and compares every copied row against its original
field by field — text, tags, both timestamps. A row that does not match rolls the
copy back, leaves the unit holding everything, and fails the open with
`STORAGE_UNAVAILABLE` naming what disagreed, rather than starting an expert
against a database that might be missing something. The unit is never emptied by
the plugin: it stays as the way back.

Ranking moved with the data because both providers now share one scorer, and the
SQLite one pushes it into SQL: substring matches over a stored search text, then
the newest update, then namespace and key. The last term is new and deliberate —
records written in one session really do tie to the millisecond, and an order
that then depends on insertion history makes a migration look like it changed an
answer. FTS5 was tried on paper and rejected for exactly this reason: it is a
different notion of a match, and a stand that gets other notes back after a
storage change has lost something no test complained about.

Nothing is removed from the built-in provider, and no record format changed: the
unit stays at version 1. Deployments that keep their memory where it was are
unaffected — they never open the new file.
