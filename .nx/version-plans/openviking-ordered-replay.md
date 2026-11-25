---
"@yadsh/dsh-openviking-memory": patch
---

Keep queued messages ahead of the session commit when multiple chats reconnect at once. Queueing during an outage no longer rereads the entire backlog for each new message.
