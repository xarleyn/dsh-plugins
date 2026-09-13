---
"@yadsh/dsh-plugin-log-ui": minor
---

A **Plugin logs** panel in the host's right Sidebar, next to the settings card
it already shipped. The panel streams what the plugins are writing right now:
a source filter over every registered plugin logger, level filters from `trace`
to `fatal`, and a text filter over the whole line, with severity colouring that
keeps quiet levels quiet and puts the warn, error, and fatal inks where a reader
looks for them. Output follows the newest line until the reader scrolls up, can
be paused, and says so explicitly when the host buffer dropped lines the panel
never read, instead of leaving a silent gap.

The panel's stylesheet is injected under its own key rather than the card's:
`injectCardStyles` treats a key it has already seen as injected, so sharing one
key between two sheets drops the second one — the settings card rendered with no
rules of its own until each sheet got its own tag.

The host half subscribes to the record bus of `@yadsh/dsh-plugin-log` and serves
`pluginLogUi.tail(cursor, limit)` from a 2000-record ring buffer, rendering each
record's fields to bounded strings because the Remote boundary carries plain
JSON. The panel opens from the right Sidebar's guide page, which is how a tab
type is reached, and needs the `sidebarRightTabs` service and the
`sidebar.right.pane.tab` seat, both now declared as required client features.
