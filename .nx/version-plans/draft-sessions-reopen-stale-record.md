---
"@yadsh/dsh-draft-sessions": patch
---

Reopening a draft no longer puts older text back into the composer.

Every seat that opens a draft hands the composer a record of its own, and a
record taken before an autosave had settled describes the draft as it was
earlier. The composer used to restore exactly what that record said: the words
on screen jumped back to the superseded text while the durable draft kept the
newer one, and the next edit was written against the revision that text had been
saved with. The Host answered `DRAFT_STALE_REVISION` — a conflict with another
browser that had never happened, on a draft whose saved text the composer had
just thrown away from view. Nothing was lost durably, and everything looked
lost.

Opening now restores the record the flush had just returned whenever that flush
concerned the same draft, so the composer shows the text the Host accepted and
the next save carries the revision that text earned. A draft that still needs
its Session shell is covered by the same repair: the shell is claimed with the
current revision rather than the one the caller happened to be holding.

Navigation is now serialized the way saving already was. Two reopen requests no
longer look up a Session and create a shell at the same time, so the slower one
can no longer finish after the faster one and leave the composer mirroring a
draft the Host is not showing.
