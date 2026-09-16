---
"@yadsh/dsh-qa-surface": patch
---

Keep the administrative console mounted while it walks its own sections. The
surface recognised the console only at the bare `/qa/admin`, so opening any
section — and any pasted deep link to a user, a conversation or one message in
it — fell back to the chat: the console vanished, and every such click left an
empty chat behind in the deployment's own counters. The console now owns its
base path and everything under it.
