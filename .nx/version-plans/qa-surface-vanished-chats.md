---
"@yadsh/dsh-qa-surface": patch
---

Remove a chat's QA record when the Harness has actually lost it — and only then.

The sweep that reclaims ownership records of deleted chats asked the live
session store what exists, and that store answers only for the sessions this
process has open. A chat nobody had opened since the last restart was therefore
absent from the answer without being gone: once its claim passed the grace
period, the record — the chat's authorization boundary — was reclaimed, and the
chat left its owner's list, the console and the counters while the conversation
itself was still on disk. The sweep now asks both halves of what the Harness
knows, the live sessions and the durable listing, and treats an incomplete
listing (a deployment that serves no durable query engine, or one that failed
this read) as a question it cannot answer: it reclaims nothing rather than
guessing.

Dropping a chat takes the rest of what the deployment kept about it. Ratings,
reviews and queue entries are keyed by conversation and outlived it, so a chat
deleted in the Harness left its verdicts behind, still counted by the metrics
and still pointing at a conversation the console could not open. The sweep
hands the ids it reclaimed to the deployment, which drops those rows; the audit
trail stays, because it records what administrators did rather than what a
conversation held.

The review reads run the sweep before listing conversations, so the console
reflects what exists when it is opened instead of waiting for the next chat
creation to trigger housekeeping.
