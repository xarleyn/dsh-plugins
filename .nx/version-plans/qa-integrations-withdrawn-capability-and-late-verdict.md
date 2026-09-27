---
"@yadsh/dsh-qa-integrations": patch
---

Two ways an integration kept behaving like a connection it no longer had.

A capability the deployment withdrew is no longer served. The broker used to
answer a call from what the account was granted when it connected — the stored
capability list crossed with the user's own policy — and never compared the
request to what the provider offers today. A deployment that narrowed a provider
(an integration scope dropped from its config, write operations turned off) went
on serving the withdrawn capability to every account that had connected while it
was still offered, until each person reconnected. The allowance is now
intersected with the live provider set as well, and the refusal lands where it
has to: before the secret is decrypted and before a single byte reaches the
vendor. The card reports a connection through the same intersection, so a
withdrawn capability leaves the list the operator sees at the same moment it
leaves the set a call is served from, instead of sitting there as a switch that
is only ever a refusal.

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

Two things had to change for that guard to actually catch a reconnect. Every
reconnect now opens a new binding generation, not only one that changes the
credential source: an operator re-saving the same managed profile from Settings
leaves the source, the profile and the stored credential exactly where they
were, so a generation that moved only on a mode switch kept that reconnect
invisible, and a verdict taken from the credential before it — an expired
service token, say — still overwrote the status of the live connection. And a
probe unlocks the credential its own binding names rather than whatever the row
points at when the read happens, so the answer it produces and the generation
the verdict is filed against are the same connection by construction, not
because nothing happened to intervene.

Both are pinned by tests: a stored grant the provider no longer offers is
refused without unlocking the secret and is gone from the card that describes
the connection, and a validation that lands after the account moved is
discarded — in either completion order, and after a re-save of the very profile
the binding already ran under.
