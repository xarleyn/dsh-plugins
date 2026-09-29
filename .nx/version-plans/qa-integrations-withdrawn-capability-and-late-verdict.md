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
is only ever a refusal. Writing an allowance goes through it too: a policy for a
capability the deployment does not offer is refused rather than stored, because
a row saved while the capability is away would wake up the moment it returns —
a permission nobody asked for, which is what a newly detected capability is kept
from by starting denied.

A verdict about an old credential can no longer rewrite the current one. A
validation probe outlives its own connection whenever the account is re-saved
while the vendor is being reached — the probe started against one token, another
took its place, and the first answer arrives last. That answer used to be
written to the row by its id, over whatever it found there, so the card kept the
new account's name while its capabilities became the old token's: a list
describing rights nobody holds any more. The write is now compare-and-swapped
against the binding the probe started from — the row itself, its revision, its
secret reference and its service profile together — and a verdict that no longer
matches is dropped and logged as `credential.validation-stale` instead of stored.
Wrapping the write in a transaction would not have helped: the gap the old answer
falls through is the await in front of it, so only the generation of the
connection decides which verdict still belongs to the row.

Comparing the revision is not enough on its own, because a disconnect deletes the
binding and the connection made afterwards numbers its revisions from one again.
A service binding that holds no personal credential is then indistinguishable from
the one it replaced on every field but the id — no secret reference, the same
profile, revision 1 — so the verdict of a probe started before the disconnect
landed on the healthy connection that followed it and filed an error status and an
error code that connection had never earned. The row id is part of the generation
for that reason: an answer may only touch the binding it was produced from. The
same window was left open on the way back to a personal credential, which reaches
upstream before it writes: the account reconnecting inside that probe used to leave
the replaced token's identity and grant on the live row, moving its revision past
the reconnect's own and recording a mode switch in the trail that the store never
applied. That write is compare-and-swapped the same way now, and a switch that
lost its binding answers `IntegrationNotConnected` and logs
`credential.switch-stale` — nothing is written, so the trail keeps no success.

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
because nothing happened to intervene. That read starts from the principal that
asked and the provider being reached, like every other lookup in the store, and
the reference only selects which generation of that connection is unlocked: a
bare reference would hand any account's credential to whoever quoted its id. A
read that loses that credential to the reconnect says so as the missing
connection it is: the operation is recorded as a failure rather than among the
calls policy declined, and the user is not told to store a token they just
replaced.

Both are pinned by tests: a stored grant the provider no longer offers is
refused without unlocking the secret and is gone from the card that describes
the connection, an allowance for it is refused while it is away and still does
not serve when it returns, a validation that lands after the account moved is
discarded — in either completion order, after a re-save of the very profile the
binding already ran under, and after the binding was disconnected and made again
with that same profile — a credential switch whose probe outlived its binding is
refused while the live connection keeps what its own reconnect wrote, and a secret
reference resolves only for the account and provider whose live binding still
carries it.
