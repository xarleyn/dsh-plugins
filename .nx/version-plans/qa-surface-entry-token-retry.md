---
"@yadsh/dsh-qa-surface": patch
---

A `/qa` entry that raced the start of the process stops dead-ending at the
token screen.

The route sends a browser without the host cookie through the host's one-time
`?token=` exchange, so the cookie is installed before the root gate sees the
request; without a token it falls back to the marker hand-off, which a
cookie-less browser cannot pass. That token was resolved lazily but remembered
*forever*, including the answer "not available": the first `/qa` request can
arrive while `connection` is not answerable yet, and from then on every such
browser went to the marker hand-off and saw the access-denied screen until the
process restarted — a boot-order race that looked random from the outside.

A resolved token is still cached (it is stable for the process), while a
failure is reported once per reason and retried on the next navigation, so a
single early answer can no longer disable the exchange for the whole run.
