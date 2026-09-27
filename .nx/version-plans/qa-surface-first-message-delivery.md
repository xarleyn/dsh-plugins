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

Chat identities are now drawn once for the whole page and handed to a session
only where that session is actually adopted. The surface re-creates this
controller whenever the account, the configuration or the route changes, and a
rebuilt controller used to name its first chat exactly as its predecessor had
named its last — so an unsent question, its attachments and the per-chat panels
outlived the chat they belonged to and were shown by the next one. Adopting a
session is the whole of it now: a first send whose session never reached a
binding, never opened, or was refused by the policy check is retried in the same
chat rather than read as another one, and a chat that takes over the screen —
because a persisted chat was refused, or because it simply vanished — starts
empty and quiet, without the question and the "sending" state of the chat it
replaced.
