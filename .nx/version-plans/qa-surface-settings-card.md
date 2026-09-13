---
"@yadsh/dsh-qa-surface": minor
---

Add an operator settings card for the deployment. The `qa-surface` namespace
was readable from the Host settings page but editable only by hand-editing the
profile; the browser half now registers a card into the shared
`settings.plugin.item` slot — Settings → Plugins → plugin configuration →
«Помощник QA» — with nine sections: the running state, the route, branding, the
session, the interface, the lockdown, accounts, sources, and embedding.

The card writes the user layer of the namespace through path-addressed
mutations, so every change stays revertible through the card's own reset, and it
reports what the running Host resolved next to the form, read through
`qaSurface/describe` while the card is visible. Values the resolver refuses in
isolation are written together in one mutation — a provider with its model,
`accounts.perUserWorkspace` with the `workspace-write` sandbox, which is also
refused alone — and a control the resolver would reject is disabled with the
reason stated instead of offered. The values that cannot be configured
(`approvalPolicy`, the white-list mode, the forbidden capability flags) stay
visible as facts.

Two transport details shaped the card. A write the Host refuses does not reject
the settings scope's promise: the scope reloads Host state and settles, so the
card confirms acceptance itself — the namespace revision advances on every
committed change, and a write that changed nothing is answered by the section —
and reports a refusal instead of leaving a control that silently does nothing.
That report also survives the status poll, which a shared error channel would
have wiped within one interval. The card renders only where the settings
namespace is readable, which the DSH gateway pins to loopback.
