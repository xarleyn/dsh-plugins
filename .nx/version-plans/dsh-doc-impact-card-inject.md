"@yadsh/dsh-doc-impact": patch
---

Fix the settings card never mounting in the web UI. The 0.1.5 client
runtime exposes only the services a module declares in `inject`, and the
client bootstrap still read `settingsScope` and `locale` through the
0.1.1-era `ctx.get` indirection, saw them as absent, and silently skipped
the `settings.plugin.item` card registration. The services are now
declared and read as context properties like every other card.
