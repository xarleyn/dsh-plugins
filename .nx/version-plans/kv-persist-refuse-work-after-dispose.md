---
"@yadsh/dsh-kv-persist": patch
---

A session request that arrives after shutdown is now refused out loud.

Disabling the plugin stopped its timers and wrote the final checkpoint, but it
did not close the door: a request that reached the coordinator afterwards was
still welcomed in. It created the session bookkeeping it had just been told to
forget, waited for the slot, asked the server for state, and streamed an answer
— persistence work running on a component that had already said it was done. A
request that was queued behind a stream still in flight joined it, and then ran
anyway once the slot came free. Both cases now get an explicit refusal that
names the disposal instead of the work: the request never reaches the server,
and the final checkpoint shutdown asked for still runs unobstructed.
