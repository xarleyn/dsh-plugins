---
"@yadsh/dsh-qa-surface": patch
---

The sources of a turn are collected from a real session journal again.

The host pairs a tool result with the call that produced it by the id written on
the result block. The Harness names that field `toolCallId` — its own validator
rejects a `tool/result` whose block id differs from `message.source.callId` —
while the plugin read `callId`, a name no real event carries. On a deployed
stand the pairing therefore failed for every call: nothing was collected, every
turn's bundle stayed empty, and everything downstream showed the consequence —
the sources panel had nothing to list, a file the chat had just read refused to
open in preview, and the answer carried no evidence. `toolCallId` is read now,
with `callId` kept as the fallback for a block that names the pairing that way.

The fixtures took their share of the miss. The host tests replayed a result
block of their own invention — `tool_result` carrying `callId`, a shape the
Harness never writes and its validator would reject — so an empty bundle looked
like a passing suite. They now carry the shape a session actually stores, and a
test pins collection to it, with one more for the fallback name so it stays a
supported path rather than a guess.
