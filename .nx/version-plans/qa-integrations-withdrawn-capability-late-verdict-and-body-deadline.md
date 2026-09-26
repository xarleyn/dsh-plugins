---
"@yadsh/dsh-qa-integrations": patch
---

Three ways an integration kept behaving like a connection it no longer had.

A capability the deployment withdrew is no longer served. The broker used to
answer a call from what the account was granted when it connected — the stored
capability list crossed with the user's own policy — and never compared the
request to what the provider offers today. A deployment that narrowed a
provider (an integration scope dropped from its config, write operations turned
off) went on serving the withdrawn capability to every account that had
connected while it was still offered, until each person reconnected. The
allowance is now intersected with the live provider set as well, and the refusal
lands where it has to: before the secret is decrypted and before a single byte
reaches the vendor.

A verdict about an old credential can no longer rewrite the current one. A
validation probe outlives its own connection whenever the account is re-saved
while the vendor is being reached — the probe started against one token, another
took its place, and the first answer arrives last. That answer used to be
written to the row by its id, over whatever it found there, so the card kept the
new account's name while its capabilities became the old token's: a list
describing rights nobody holds any more. The write is now compare-and-swapped
against the binding the probe started from — revision, secret reference and
service profile together — and a verdict that no longer matches is dropped and
logged as `credential.validation-stale` instead of stored.

The request deadline now covers the answer, not only its headers. An upstream
that replies at once and then goes quiet held a call open for as long as it
liked: the timer was cleared the moment the response arrived, so the configured
budget bounded the wait for headers and never the reading of the body. The
deadline now runs until the answer has been consumed — in the one loop the six
providers that read a GET share, and in the transport that posts, which already
kept its own read inside the timer — so no provider bounds headers alone. A body
nobody will read is released before the attempt that replaces it, so a retried
request no longer leaves the previous connection open beside it. An abort that
lands mid-read surfaces as the provider's own timeout, while a verdict the
provider already named — a mapped status, a body over the cap — stays final. And
a timeout earns no retry: the deadline is this deployment's own verdict, not a
fault the vendor may have healed, so a stalled upstream is asked once even where
the configuration allows three attempts. Connection faults keep their retries,
including on TeamCity, whose budget is meant for a busy on-prem server.

All three are pinned by tests: a stored grant the provider no longer offers is
refused without decrypting anything, a deferred validation that lands after a
reconnect is discarded in both completion orders, and a response whose stream
never finishes is cut off by the budget it was given and not asked about twice.
