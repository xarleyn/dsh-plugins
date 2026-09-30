---
"@yadsh/dsh-ui-repair": patch
---

The UI Repair settings card opens from the Plugins panel now.

It used to contribute a tab to the Host's "Built-in plugins" settings section.
The same form is registered into the Host's `plugins.row.config` slot instead,
keyed by `@yadsh/dsh-ui-repair#dsh-ui-repair` — this bundle's package name and
the row id its `cordis.patch.yml` declares — so its configuration page opens
from the row of the bundle on the Plugins page, beside the row's own switch.

Nothing about the stored settings moved. The configuration namespace stays
`dsh-ui-repair`, which is the same row id the Host derives that namespace from,
so a mode, a confidence threshold, or a list of ignored selectors saved before
this update is still what the card reads after it.

The card keeps the shell AGENTS.md pins plugin cards on, inside a list of its
own, because the page seats it in an empty section. The page seats the same
entry twice: as the row's one-liner (`view: 'summary'`, printed into a paragraph
the row shows when it has no description of its own) and as the configuration
body (`view: 'page'`). The entry therefore answers the first with plain words —
the current mode, nothing else — and renders the form only for the second.

Only the render site changed: the runtime, the scans, the repair actions and the
write path of every field are untouched.
