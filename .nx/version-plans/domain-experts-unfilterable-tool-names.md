---
"@yadsh/dsh-domain-experts": patch
---

An expert starts even when its tool policy names a tool the filter may not name.

A domain's `tools.allow` became the child's tool filter verbatim, and the
runtime refuses a whole composition over one name it cannot resolve: a child
composes its parent's preset into its own scope, so every tool that preset
mounts — the filesystem readers, the skill catalog, the web tools — is a name
`restrict()` rejects, and a single one of them took the run down. Two failures
came from that: the product experts, whose policies list `glob`, `grep`, `read`
and `skill`, died as `WORKER_UNAVAILABLE` on a deployment that mounts those on
the agent plane, and the answer reviewer did the same whenever the
`mcp__openviking__*` tools its policy lists were not yet registered.

The start is now a two-step: the runtime's own refusal names exactly the
entries it could not resolve, and the run is retried once without the ones the
filter actually carried. Dropping such a name costs nothing when the expert's
preset provides the tool — an own-layer tool stays visible whatever the filter
says — and costs that single tool when nothing mounts it; either way the audit
records a `TOOL_UNFILTERABLE` degradation naming it, so the inspector shows what
went missing instead of the expert being lost with the complaint that its policy
names a tool. A refusal that names nothing the filter carried is unchanged: it
is not this plugin's to explain and it stays loud.
