---
"@yadsh/dsh-session-audit": patch
---

An audit is bound to its session again when its producer wrote the session id
without the harness' prefix.

`analysis.json → trajectory.sessionId` decides which session an audit belongs to,
and the host used to take the string exactly as written. Session ids are spelled
`session-<uuid>`; a producer that recorded the bare `<uuid>` named a session the
host has never heard of. The audit registered cleanly and then sat under a key no
view asks with — no badge, no report, and a listing of the audits no session can
show that said nothing was wrong with it. On a stand fed by such a producer,
every audit after the first looked as though it had never been written.

A declared id that lacks the prefix is now matched as the complete prefixed id it
would become, against the sessions the host actually has. The prefix is put back
only on an exact hit, so the repair corrects a spelling without ever choosing a
session the analysis did not name: a truncated id is left alone rather than
snapped to the nearest one, an id the corpus does not carry is bound exactly as
before, and a session corpus that cannot be listed costs nothing. An audit whose
producer wrote the id correctly never pays for the lookup.

The audit's own two files are now compared through the session it ended up bound
to. Previously the bare id was held against the directory name beside it, so a
repaired audit arrived carrying a warning about a disagreement between files that
in fact meant the same session.
