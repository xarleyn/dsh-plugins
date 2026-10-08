---
"@yadsh/dsh-plugin-log-ui": minor
---

A plugin's log level can now be raised for a moment instead of for good.

The settings card on the Host's **Plugins** page had one way to make a plugin talk:
pick `debug` in its row, which writes the level into the stand's Config and keeps it
there until someone returns to the same card to put it back. Diagnosing a shared
stand therefore meant a permanent change plus a manual undo. The
**Registered plugins** section now offers a second action beside the saved selects:
choose a plugin, a level, and how long the look should take — 5, 15 or 30 minutes, an
hour, or until you revert it yourself — and the Host applies that level to the running
loggers without writing a setting. A row going through a held level is marked
`not saved`, while its select keeps showing what the settings hold, so looking now and
leaving forever are two different actions on one screen. The window closes on the
Host's own timer and reaches loggers that register after the hold was set, so a card
nobody left open still ends the level on time; when it does, the plugin goes back to
its saved override rather than to the default level. A held level lives in the Host
process and appears in neither the Config nor what the settings report.
