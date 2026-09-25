---
"@yadsh/dsh-domain-experts": minor
---

An expert's memory now belongs to the account that learned it. Where the
deployment has accounts, the writable namespace of a run is
`domain/payments/u/<account>`, and the domain's own namespace joins the
read-only tier every account of that domain shares — so a note one account's
expert wrote stops being a rule another account inherits. An account is read
from the caller's own session on the host, never from a tool argument, and a
delegated run keeps the account of the run that spawned it. With no accounts
surface mounted, or with `perUserMemory: false`, one namespace per domain stays
exactly as it was.

What that namespace is for is now said out loud. The composed policy tells the
expert to decide who a note is true for before recording it: a tool that was
refused, a source that was not mounted, a path that could not be read describes
this caller's access, not the domain, so it belongs in the answer and not in
memory that outlives the run. A run no account has claimed reads as before and
is refused a write, because the only namespace left to it is the one every
account reads — `MEMORY_SCOPE_DENIED` with the reason, instead of a note that
reads as domain truth tomorrow.

The inspector gained the note each memory namespace carries, the Memory tab says
which namespace a run of an account-scoped deployment really writes, and
`domain_memory` states the same rule in its own description.
