---
"@yadsh/dsh-qa-surface": patch
---

The first message of a newly created chat no longer disappears without a trace.

"New chat" spends no session: the chat is created by the first prompt, and that
was the moment the message died. The composer kept its unsent text as component
state keyed by the bound session, so binding the freshly created session
rebuilt the field empty — the question vanished from the browser before the
Host had accepted anything, and the chat came up empty with no error in the
interface and nothing on the wire. The composer and the per-chat state beside
it are keyed by the chat now, which a draft keeps through its own lazy session;
the text and the attachments are handed back only when the session has taken
the prompt.

A submission that cannot be sent is said out loud instead of being dropped: a
chat still being created and a chat that is no longer open both answer with the
reason, and the draft stays in the field to be sent again.
