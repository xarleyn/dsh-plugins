---
"@yadsh/dsh-qa-surface": patch
---

A question nobody is waiting for any more stops being answered.

The integration API released its concurrency slot correctly, but the turn outlived
the caller: `prompt` carries the caller's signal only up to admission, and the
wait ending is not the work ending. So a bridge that gave up left the agent
running — model still generating, tools still firing, the chat's agent still
busy — and the next question continued into that chat queued behind work nobody
had asked for, which is how a stand ends up with several asks hitting its full
answer budget in a row.

An abandoned ask now stops the turn it started, and only that turn: the stop
fires on the caller's own disconnect, and only when the session's durable log
says this request's turn is still running. Other callers' queued prompts survive
it. An expired budget is unchanged — that is the escalation the bridge polls
with the `chat_id` it was handed — and both outcomes now leave a line in the log
(`integration.dropped`, `integration.turn-abandoned`), where before a dropped
caller left no trace at all.
