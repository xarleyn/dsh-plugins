---
"@yadsh/dsh-web-fetch-authenticated": patch
---

Read the credential provider per operation, so authentication works at all in a
real Host. The plugin captured `ctx.get('credentials')` in its constructor, and
cordis' strict `Reflect.get` reports a service whose providing fiber is not
ACTIVE yet as absent: `@deepseek-ai/dsh-credentials-local` reaches ACTIVE only
after its asynchronous document load and watcher setup, while profile bundles —
this one included — are applied earlier. The captured value stayed `undefined`
for the whole process lifetime, so every rule whose auth is not `none` failed
with `AUTH_FETCH_CREDENTIAL_MISSING` while the DSH credentials page showed the
stored secret as configured, and the settings card's Test reported `missing`
next to a reference the Host itself could describe.

`createCredentialResolver` now takes a source callback and reads the provider on
every `resolve`/`describe`; the exported signature changed, so embedders pass
`() => ctx.get('credentials')` instead of an instance. A regression test proves
the wiring under a real Cordis context — a provider mounted after the plugin is
constructed still authorizes a test fetch — beside unit coverage for a provider
that appears late, a rotated value, an empty stored value, and a malformed
reference name.
