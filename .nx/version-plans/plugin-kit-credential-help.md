---
"@yadsh/dsh-plugin-kit": minor
---

Add the shared credential-help contract and the note a settings card renders
next to the field that asks for a token.

A card that asks for a secret without saying where the secret comes from sends
the user out of the application: to the vendor's developer pages, to work out
which kind of token is wanted, which permissions it needs, and what exactly to
paste back. `CredentialHelp` is the metadata that answers those questions — the
credential mechanism (`api-key`, `personal-access-token`, `oauth`,
`service-account`, `app-password`, `custom`), where the credential is obtained,
which documentation describes the authorization, the required permissions and
the steps to follow. It is metadata and nothing else: the shape has no field a
credential value, a snapshot or an authorization result could travel in, which
is what lets it be rendered for a browser that is never given the secret.

The contract module carries no imports, so the same file serves host code that
declares the defaults and a browser bundle that renders them.
`sanitizeCredentialHelpUrl` keeps only `http(s)` — `http:` for loopback, private
and self-hosted hosts, never an address with a credential inside, and never
`javascript:`, `data:` or `file:`. `resolveCredentialHelp` merges what an
integration declares with what its deployment overrides, and reports what the
override got wrong instead of failing: a broken address hides its own link,
because help must never be a runtime dependency of the connection.

On the client side `CredentialHelpNote` renders the trigger and its disclosure
panel, `credentialHelpView` turns metadata into the view, and
`CREDENTIAL_HELP_CSS` carries the rules — canonical `--dsw-alias-*` tokens only,
like the card shell. The note is slot-agnostic: it fits a plugin settings card,
a feature-owned tab, and the Models page's provider cards. When there is no
metadata it renders nothing at all, and the plain credential field stays what it
was.
