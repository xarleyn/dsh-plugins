---
"@yadsh/dsh-session-audit": patch
---

The refresh tests now stamp the artefacts they compare, so the suite stops
measuring the resolution of the filesystem it runs on.

One test rewrote `analysis.json` and asked whether the audit's modification
stamp had moved. Two writes in the same millisecond leave a stamp where it was,
so the assertion could fail on a service that had done everything right: it
re-reads the artefact on a change of size, reports the new verdict, and only the
stamp stays behind because a stamp is the newest of the two artefacts' mtimes.
The modified artefact is now pinned to an instant the test chooses and compared
to that instant exactly, which says at least as much as the inequality did and
nothing about the clock beneath it.

A second test carried the same assumption without yet failing on it. It lists a
session's audits newest first, and two audits stamped in one millisecond are not
ordered by arrival — the tie breaks on the audit id, which would have made the
older audit the active one. The newer audit is stamped explicitly now, and the
test asserts the order its name promises rather than a count.
