---
"@yadsh/dsh-user-correction-miner": minor
---

Port to the DSH session format v3: the live-session snapshot feeds from
session.snapshotEvents() and fixtures use the isSeeded header with branded
log offsets. The supported host range moves to >=0.1.5-rc.2 <0.2.0, dropping
0.1.1-rc.2.
