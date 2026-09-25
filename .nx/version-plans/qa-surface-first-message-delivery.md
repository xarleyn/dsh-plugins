---
"@yadsh/dsh-qa-surface": patch
---

The first message of a newly created chat no longer disappears without a trace.

Pressing "New chat" creates no conversation of its own: the chat appears with
the first question sent into it, and that hand-off is where the question died.
As soon as the new chat was created, its composer was rebuilt empty, so the
question left the browser before the stand had admitted it — no answer, no
error on screen, nothing on the wire. The question now stays in the field until
the chat has admitted it, and the files attached to it survive that hand-off.

A question that could not be sent says so instead of vanishing: a chat that is
still being created and a chat that is no longer open both answer with the
reason, and the field keeps the question so it can be sent again.
