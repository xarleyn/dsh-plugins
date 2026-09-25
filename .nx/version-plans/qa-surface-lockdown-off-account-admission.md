---
"@yadsh/dsh-qa-surface": patch
---

The account gate is asked who owns a chat even when lockdown is off, and the client suite fails on console noise it did not expect.

`attestPolicy` returned the session as attested the moment it saw
`lockdown.enabled: false`, so with `accounts.enabled` on the browser bound a
chat and enabled the composer without ever calling the Host. The Host checks
account identity and ownership before it looks at lockdown — its own comment
calls that order "independent of lockdown" — and every plugin-owned remote
re-runs that check, but the bind path is the one that decides whether this
browser may speak in the chat it restored. Browser chat persistence is keyed by
deployment and route rather than by account, so signing out and back in as
another user in the same browser restores the previous account's chat, and the
skipped call was the only thing that would have named it as somebody else's.
The call is now made whenever accounts are enabled: with nothing pinned, the
Host answers with its vacuous proof, `proofMatchesConfig` compares only the
session the proof names, and a refused restore falls into the path the surface
already has — the stored id is forgotten and the account gets a chat of its
own. A deployment without accounts still skips the round trip, because there is
one principal and nothing to prove. `docs/CONFIGURATION.md` states the split,
which the text previously described only for the lockdown-enabled case.

Unexpected console output in the client tests now fails the test. The suite was
green while jsdom printed an uncaught `props.route.subscribe` TypeError and
nineteen React warnings, so a crash that no case intended looked the same as a
run that had none. A setup file wraps `console.error` and `console.warn`,
matches what it catches against an explicit list of the refusals the tests
provoke on purpose — attestation reasons, a refused upload, an account action
the Host turned down — and fails any line outside it. Three things the guard
found are fixed rather than listed: the footnote section was appended to the
rendered blocks without a key, the admin-route fixture left `accessApi.session`
returning nothing which the surface reads once a chat is bound (so a mount
effect threw and the failure only reached the console), and the async updates
behind the auth gate, composer, skills page, question form and surface bootstrap
are now flushed inside `act`, with the crash the guard test feeds its boundary
suppressed at the window error event the way the panel host already does.
