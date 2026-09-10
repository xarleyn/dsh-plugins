---
"@yadsh/dsh-ui-repair": minor
---

Migrate to the 0.1.5 settings surface: the settings section installs via
SettingsProvider.installSection under ctx.inject(['settings']) with the
plain "ui-repair" namespace, and ctx.slots resolves through the
client-ui-renderer merge. The supported host range moves to
`>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.
