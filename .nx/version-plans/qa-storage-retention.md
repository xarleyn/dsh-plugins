---
"@yadsh/dsh-qa-surface": minor
---

Bound what the deployment's own stores keep, and stop paying for the whole
history on every write.

Durable provenance was one JSON file holding every chat of every user, and
every agent turn — including every subagent turn — read, parsed and rewrote the
whole of it synchronously. The cost of a turn therefore grew with everything
the deployment had ever recorded, and the write blocked the host's event loop
for every user on the stand: measured on a live deployment, one turn cost 7 ms
over a 121 KB file and 106 ms over a 12 MB one. Provenance is now one file per
chat under `$DSH_HOME/qa-sources/`, which is exactly the unit a writer touches,
because the read path was already per-chat: at the same volume a turn costs
4.2 ms instead of 106 ms, and filling the store is linear rather than
quadratic. A pre-0.8.0 `qa-sources.json` is split into per-chat files on first
use and renamed to `qa-sources.json.migrated-<ISO>`, so nothing is lost and the
old file stays readable.

Retention bounds what is kept: the newest 200 turns per chat, the 500 most
recently written chats, and any chat untouched for 30 days. An old conversation
still opens; its sources panel may have been released. Every bound is
configurable under `sources.retention`, and zero keeps everything.

The accounts file was the only store with no bound at all, and it held two kinds
of redundant bytes. Every admitted chat froze the capabilities it was admitted
with, and on a real deployment those snapshots are almost always the same list:
25 of them were byte-identical and made up 45% of the file. They are now stored
once per distinct policy with a reference per chat, which took the live file
from 84.3 KB to 26.8 KB without losing a byte. Nothing removed ownership records
either, so a record outlived its chat forever: a deleted chat stayed in the
admin console's conversation list and in its counters for good. The deployment
now reclaims records of chats the Harness no longer knows, once they are older
than a day, and never touches a chat that exists — a record is a chat's access
boundary, so only a vanished chat may lose one. `accounts.retention` controls
it, including turning it off.

A completed turn that collected nothing is stored as its turn number rather
than an empty frame, and an incomplete collection is never collapsed into one.
