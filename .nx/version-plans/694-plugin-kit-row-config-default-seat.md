---
"@yadsh/dsh-plugin-kit": minor
---

A settings card routed through the kit's helper reaches the Plugins panel row now.

`registerSettingsCard` and `registerSettingsSlot` mounted a card that named no
`slotName` into `settings.plugin.item` — the keyed seat the Host deleted in
`0.1.7`. Registering into a seat that no longer exists throws nothing: the card
was drawn nowhere, neither on the plugin's row nor in Settings. The default is
`plugins.row.config` now, the keyed seat of the bundle's own row on the Host's
Plugins panel, which is where a plugin's configuration card belongs. The constant
took the same rename, `PLUGIN_ROW_CONFIG_SLOT`, so the published surface stops
naming a seat that is gone.

Breaking for a consumer that imported `SETTINGS_PLUGIN_ITEM_SLOT`; no package of
this repository did. A plugin that passes `slotName` behaves exactly as before,
and one seated on a surface it must frame itself — `settings.section`,
`settings.plugins.tab` — still names that seat, and `CardShell`,
`PLUGIN_CARD_SHELL_CSS` and `ChevronDown` stay published for those two cards. A
row card passing no `styles` is the point: the panel draws the frame, the heading
and the expand control, so our shell there would be a second card inside the
Host's.

The row seat is keyed `<package name>#<row id>` rather than by a bare namespace,
and `SettingsCardOptions.key` now says so — the same string is the namespace the
Host resolves the plugin's volatile Config under, so a value saved before this
change still reads back through it.

The bump is `minor`, not `major`: below `1.0` that is the step this repository
takes for a break, since `major` on a `0.4.0` package publishes `1.0.0` rather
than announcing anything.
