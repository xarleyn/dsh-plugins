---
"@yadsh/dsh-qa-integrations": patch
---

Two ways an integration kept behaving like a connection it no longer had, and a
request budget that spent itself three times over.

A capability the deployment withdrew is no longer served. The broker used to
answer a call from what the account was granted when it connected — the stored
capability list crossed with the user's own policy — and never compared the
request to what the provider offers today. A deployment that narrowed a provider
(an integration scope dropped from its config, write operations turned off) went
on serving the withdrawn capability to every account that had connected while it
was still offered, until each person reconnected. The allowance is now
intersected with the live provider set as well, and the refusal lands where it
has to: before the secret is decrypted and before a single byte reaches the
vendor.

A verdict about an old credential can no longer rewrite the current one. A
validation probe outlives its own connection whenever the account is re-saved
while the vendor is being reached — the probe started against one token, another
took its place, and the first answer arrives last. That answer used to be
written to the row by its id, over whatever it found there, so the card kept the
new account's name while its capabilities became the old token's: a list
describing rights nobody holds any more. The write is now compare-and-swapped
against the binding the probe started from — revision, secret reference and
service profile together — and a verdict that no longer matches is dropped and
logged as `credential.validation-stale` instead of stored. Wrapping the write in
a transaction would not have helped: the gap the old answer falls through is the
await in front of it, so only the generation of the connection decides which
verdict still belongs to the row.

Where the deadline is this deployment's own verdict, it is now asked only once.
A timeout is folded into `UpstreamTimeout` by every transport, and three of them
— Jira, TeamCity and Confluence — let anything they folded earn another attempt,
so a request whose headers never arrived was re-sent for as many retries the
configuration allows, each one waiting out the same budget the deployment had
already given up on: `retries: 2` cost three deadlines to learn that an address
is not answering. Those three now decline their own timeout the way the other
providers do, and keep earning retries for a fault the upstream actually
produced, so a busy on-prem TeamCity is still asked again before it is called
gone.

All three are pinned by tests: a stored grant the provider no longer offers is
refused without decrypting anything, a deferred validation that lands after a
reconnect is discarded in both completion orders, and a request that never
answers costs one attempt in each of the three providers while a refused
connection still costs the whole budget.
