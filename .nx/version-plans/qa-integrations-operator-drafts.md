---
"@yadsh/dsh-qa-integrations": patch
---

The operator card keeps what was typed, and a provider problem is visible.

Two halves of one complaint: the card is where a deployment's shared connection
settings are edited, and it lost work while the roster refreshed — a half-typed
base URL or token was gone the moment the list re-rendered, so a slow provider
made the card feel like it was fighting the operator. Drafts are now kept per
provider and survive a refresh and a switch between rows.

The other half is silence: a provider that answered with a shape the plugin did
not expect, or refused the credential, left its row looking configured, and the
operator only found out from a chat that could not read anything. The row now
carries the failure it produced, with the provider's own words, so a bad
credential reads as a bad credential rather than as a plugin that does nothing.
