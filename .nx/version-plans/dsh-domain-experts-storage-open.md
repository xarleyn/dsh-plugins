---
"@yadsh/dsh-domain-experts": patch
---

The first `domain_expert` call after a plugin start no longer refuses with "Domain storage is not open yet".

The storage open is lazy and memoized, and the tools resolved their definition through a synchronous handle check: the one call that raced the open was refused, and because models rarely retry, a restart silently cost the first delegation. The tool dependencies now await the one-time open, so the racing call waits and proceeds; a storage failure that already happened surfaces its underlying `STORAGE_UNAVAILABLE` cause ("Domain storage could not be opened: …") instead of the misleading "not open yet".
