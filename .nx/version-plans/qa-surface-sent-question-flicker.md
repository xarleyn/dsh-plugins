---
"@yadsh/dsh-qa-surface": patch
---

The sent question stays on screen while the turn takes it over.

The browser draws a submitted question itself and hands that row to the
transcript once the Host's own copy of it arrives. The hand-off was timed by the
session's running bit: a chat that had been seen running and then read idle
again retired the optimistic row. That bit reaches the surface through the
session list as well, and a stale `false` relayed at the start of a turn retired
the copy before the Chat slice had assembled the durable node — the question
vanished for about a third of a second and came back, with the composer
unlocking and the empty-chat screen flashing in the gap. On the first question
of a chat it read as a lost message even though the prompt had been taken.

The row is retired by facts the transcript itself carries now: its own durable
user node reaching the projection, or a turn the Chat slice has recorded as
closed. The running bit on its own removes nothing. A chat whose transcript
never shows the row still lets go once a turn ends, so the composer cannot stay
locked by a copy that will never be superseded.
