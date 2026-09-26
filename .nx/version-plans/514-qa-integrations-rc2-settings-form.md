---
"@yadsh/dsh-qa-integrations": patch
---

The plugin configures its own profile entry and builds against a 0.1.7-rc.2 host.

`0.1.7-rc.2` rewrote the settings subsystem: `settings.installSection` and the
`settings.plugin.item` slot are gone, the settings namespace of a plugin is its
profile entry id, and a field is editable from the browser only if its schema
node carries `.volatile()`. The package kept a namespace beside its entry and
registered its operator card into the deleted slot, so it neither compiled nor
found its surface against an rc.2 host.

The composition root now marks every knob the card reaches `.volatile()`, the
service reads those references once per operation instead of holding a snapshot
from mount, and a committed edit reaches the running service through
`loader/volatile-update` — the same live re-apply as before, with the provider
registry, the instance lists and the tool mount rebuilt from the current value.
The plugin declines the generated settings page for its own entry, because it
ships its own card, and the card is now a page of the Plugins settings tab strip
(`settings.plugins.tab`) that resolves its `ConfigForm` through `configForms` and
mounts only while the Host really serves the entry. Its card shell is unchanged,
and so is the boot-path exception: storage and master-key paths are edited,
logged and applied on the next restart.

One behaviour moved. Write-time validation of constraints a schema node cannot
express (a TeamCity host pattern matching nothing, a duplicated instance id) is
no longer refused before persistence: the Host validates against the schema, the
value is stored, and the resolvers keep the running service on its previous
state and log `config.rejected` instead of half-applying it.
