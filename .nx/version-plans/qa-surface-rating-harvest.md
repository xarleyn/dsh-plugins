---
"@yadsh/dsh-qa-surface": minor
---

Recover the answer ratings that stayed behind in people's browsers.

Every thumbs given between per-message feedback shipping and the fix that
started sending it to the Host lives only in `localStorage`, and nothing reads
it any more. A browser's ratings map is chat-scoped and keyed by the answer's
browser id, `assistant:<log position>`, so a rating of a chat this account owns
can still be traced back to the durable row it judges — but only once, because
the map carries no timestamp and no reasons, so it cannot tell a lost rating
from one the Host already holds a fuller version of. Replaying it through the
ordinary rating write would replace a negative verdict with its reason and
comment by the bare thumbs.

The Host therefore gained an insert-only write, `adminHarvestFeedback`: it
records a rating nobody has filed yet, reports what it already holds instead of
rewriting it, and refuses a conversation the token does not own entry by entry,
so one foreign chat cannot lose the rest of the batch. On the first login of an
account the surface reads its local maps through that write — only the chats the
account owns, only the ids that name a log position, in batches — and marks the
account as read afterwards, so the replay never repeats and a failed pass is
retried by the next login rather than lost. Ratings whose answer id names no log
position, and the deployment-wide map the first releases wrote, stay in the
browser: guessing which chat a thumbs belonged to would put words in the
reviewer's mouth.
