---
"@yadsh/dsh-qa-integrations": minor
---

Explain the credential field: where each provider's token comes from, what to
grant it, and where the deployment can point somewhere else.

Every provider card ends in a secret field, and until now each one explained
itself in its own words — a sentence in the card, or nothing at all where the
answer was long. That copy is now metadata declared next to the provider
(`src/providers/<id>/credential-help.ts`): the credential mechanism, the page
that issues the credential, the vendor documentation, the required permissions
and the steps, with the trigger wording picked from the mechanism, so an OAuth
connection is not told to "create a token" and a Bitrix24 incoming webhook says
what it actually needs. The cards lost the guidance that duplicated it; the
sentence about how the secret is stored stays where it was.

The help reaches the browser on the authenticated `qaIntegrations/providers`
call, already merged with the deployment's overrides. It is metadata only: no
credential value, snapshot or authorization result travels in the payload, and
the credential architecture is untouched — secrets stay write-only, encrypted
at rest and invisible to the browser. Because the addresses live in the Host,
a deployment can replace any of them per provider through
`credentialHelp.<id>` in its config — corporate GitLab, Jira Data Center, an
internal wiki, a proxy gateway — or turn the help off for one provider without
touching the field.

Failure stays proportionate. Metadata is never a runtime dependency: without it
the card renders the plain field; an unusable address hides only its own link
and is reported once at startup as `credential-help.override`; an unknown
mechanism degrades to `custom`; and a vendor page that moved cannot fail a
connection. Only `http(s)` renders — `http:` only for loopback, private and
self-hosted hosts — and external links open with `noopener noreferrer`.

The gate follows the same line: `verify:package` asserts that every provider
ships its declared help and that no declared address reaches the client bundle,
and the bundle's design tokens are checked against the tokens the Host actually
defines.
