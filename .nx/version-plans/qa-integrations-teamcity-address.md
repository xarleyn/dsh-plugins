---
"@yadsh/dsh-qa-integrations": minor
---

Move the TeamCity address out of the connect form and into the deployment's
configuration. One TeamCity serves the whole stand, so asking every user to type
the same host only invited a broker pointed at a host of the caller's choosing;
`teamcity.serverUrl` is now operator input, canonicalized and checked against
the address policy while the config is resolved, re-checked on every call, and
never stored in the credential. Repointing or removing it closes every
connection made against the old value.

The card shows the configured address as a line of text and asks for the token
alone. A deployment that mounts TeamCity without an address is valid but inert:
the card says there is nothing to connect to instead of offering a form whose
save would be refused. Existing connections keep working — a credential stored
with the address the old form collected is accepted and read for its token, and
the token is now spent against the deployment's address.

`teamcityServer` joins the plugin's RPCs so a card can learn the address without
one; it is token-gated like the GitLab instance list, because the address of a
stand's CI is not something an unauthenticated caller needs.
