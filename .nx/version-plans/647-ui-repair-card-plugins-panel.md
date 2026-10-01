---
"@yadsh/dsh-ui-repair": minor
---

The UI Repair settings card opens from the Plugins panel now, not from a tab of
the Settings "Built-in plugins" section.

The card edits exactly one thing — this bundle's own Config — and the panel
declares a configuration seat for that: `plugins.row.config`, keyed by
`<package name>#<row id>`. The row this bundle's `cordis.patch.yml` declares is
`dsh-ui-repair`, the same string the Host has resolved the plugin's live Config
under since `0.1.7`, and the id its settings tab was filed under before this
release, so the seat moved and the namespace did not: a mode, a confidence
threshold or a list of ignored selectors saved before this release is read back by
the card after it.

The page asks this entry for two views. The form belongs to the `page` view, and
it keeps resolving its own live configuration through the settings domain rather
than taking the page's `{ state, mutate }` view, which can neither be subscribed
to nor written field by field; that form arrives in the card's face as `settings`,
because the page hands its registrant a prop called `form`. The `summary` view is
the row's one-liner, and the entry answers it with the sentence the card's header
already carries — mounting the form there would draw a page inside a line of text.

The card keeps its shell — the standard plugin-card border, chevron and open
state, in a list of its own, because the row's configuration section supplies no
list — and the shell contract the package gate asserts is unchanged. Only the
render site moved: the runtime, the scans, the repair actions and the write path
of every field are untouched.
