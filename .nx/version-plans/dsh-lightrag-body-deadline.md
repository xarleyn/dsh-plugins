---
"@yadsh/dsh-lightrag": patch
---

A retrieval call now ends within `timeoutMs` even when the server stops
mid-answer.

The budget used to cover the response headers only: the timer was cleared the
moment `fetch` resolved, so a LightRAG server that answered and then stopped
delivering chunks left the tool call pending indefinitely — no deadline was
left to fire, and the host's own cancellation was the only way out. Each body
chunk is now read against the request's abort signal, and the stream is
cancelled on every way out of the read, whether the byte cap, the deadline or a
broken transfer ended it.

Failures say which half of the exchange was lost. A body that stalls is a
timeout that names the body rather than a host that never replied, and a
transfer cut short folds into `unreachable` with the transport's reason instead
of escaping as an untyped error. The README and SPEC state that one budget
covers the whole request.
