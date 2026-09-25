---
"@yadsh/dsh-openviking-memory": patch
---

The user space a profile is read from is now resolved per OpenViking identity
instead of once per process, so the second account of a shared deployment reads
its own `viking://user/<space>` rather than whatever the first account resolved.
Re-pointing the endpoint asks the new server again instead of reusing the old
answer.

A queued write now carries the identity it was queued as, so the offline queue
replays after the server recovers. A deployment that allows memory without
naming a per-account user used to refuse every replay, and its backlog aged out
of the queue unsend; an entry whose account space is genuinely unknown still
waits instead of guessing.
