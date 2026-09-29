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
this update is still what the card reads after it. The card keeps the shell
AGENTS.md pins plugin cards on. It answers the page's `summary` view with a
one-line state rather than the whole form, because the page renders that view
into a single paragraph.

Only the render site changed: the runtime, the scans, the repair actions and the
write path of every field are untouched.
