---
"@yadsh/dsh-prompt-firewall": patch
---

The plugin's own configuration became the live settings namespace, and its card moved to a slot the 0.1.7-rc.2 host still serves.

`0.1.7` rewrote the settings subsystem: `ctx.settings.installSection` and the
`settings.plugin.item` slot are gone, and the two things they kept apart — the
profile `Config` and a separately registered live namespace — became one. A
field is editable while the plugin runs exactly when its schema node carries
`.volatile()`, and the namespace is the profile entry id. The package still
called `installSection` and registered its card in the deleted slot, so it
neither compiled nor showed a configuration page against an rc.2 host.

Every editable field of the config schema is now a volatile reference — the
nested `audit` and `metrics` containers each as one reference, which is what
the card writes when it changes a single switch inside them. The class dropped
its cached resolved config, its compiled rules and its `reloadRules()` hook: it
takes one snapshot per operation instead, so a Host commit into the running
entry is the only thing that changes behaviour and there is no local copy that
could go stale. The namespace constant carries the entry id
`dsh-prompt-firewall` rather than the Cordis plugin id `prompt-firewall`, which
is what `settings.update()` addresses a section by.

The card registers under `settings.plugins.tab` — the slot that survived the
rewrite, and where the plugin's Remote-backed inspector belongs — reading and
writing through `ctx.configForms`. It keeps the shared card shell, per the
epic's D1: the outer markup, the canonical stylesheet and the chevron are
unchanged, and the `<li>` root now sits in a list the plugin owns. Callers see
the same `inspect()` and `setSectionPolicy()` surface with the same
`allow`/`block`/`protect`/`clear` vocabulary and the same revision fence; only
where a deployment edits the settings and what a stale write is refused by
moved.
