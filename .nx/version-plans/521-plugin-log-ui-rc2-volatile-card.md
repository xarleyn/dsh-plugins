---
"@yadsh/dsh-plugin-log-ui": patch
---

The logging card survives a 0.1.7-rc.2 host, and its settings now live with its config.

The card mounted in the Host's `settings.plugin.item` seat, and `0.1.7` deleted
that slot: the rewrite folded a plugin's browser-editable settings into its
profile Config, so a field is editable exactly when its schema node carries
`.volatile()` and the namespace the browser reads is no longer a name the plugin
invents but the profile entry it was loaded under. For this package the settings
move from the section `plugin-log` to the entry `dsh-plugin-log-ui`, which means
levels recorded under the old section are not read back — the Host logs one
warning and starts from the defaults.

The card now sits as its own tab on the Settings → Plugins page, because that is
the slot which survived; it keeps the shell every DSH configuration card uses,
and gains the list element that page does not supply, since the shell's root is
an `<li>`. The tab hands a registrant nothing, so the card resolves its own form
and reads it through the same three-state snapshot as before. What the card
offers is unchanged: the default level, the per-plugin overrides, the file
format, and the count of live consumers.

The service lost its registration call and its pushed value source with it. It
now reads each field through its live reference at the moment it applies the
policy, so an edit reaches the loggers on the next poll of the card that made it
rather than through a callback the Host no longer offers — and a Config captured
once at construction, which is the bug that callback existed to hide, fails a
test instead of passing quietly.
