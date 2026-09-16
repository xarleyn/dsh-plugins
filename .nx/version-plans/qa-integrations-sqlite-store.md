---
"@yadsh/dsh-qa-integrations": minor
---

Keep connections and their audit trail in a database instead of one JSON
document.

The store was read, parsed and rewritten whole on every operation, and it held
the audit trail — the part that grows with usage — inside the same document as
the connections: every lookup parsed every audit row ever written, and the
broker appends a row per tool call. A store with a working audit trail made
each call more expensive than the last. Connections, encrypted credentials,
per-operation policies and the audit trail are tables now, so a lookup reads the
row it asks for and a call appends the row it produces.

Two bounds keep the audit trail finite: `auditRetentionDays` (90 by default,
0 to keep by age only) and a hard cap of the newest 5000 rows whatever the age
bound says. Both are applied as rows are written.

The pre-0.8.0 `qa-integrations.json` is imported on first use — connections,
credentials, policies and audit — verified inside the transaction, and renamed
to `qa-integrations.json.migrated-<ISO>`. A leftover file never overwrites a
live connection: the operator's working credential wins, and the file is left
where it is.
