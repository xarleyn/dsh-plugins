---
"@yadsh/dsh-model-safety-gate": minor
---

The Safety Gate card opens from the plugin's own row in the Plugins panel now,
not from a tab of the Settings "Built-in plugins" section.

The card edits exactly one thing — this bundle's own Config — and the Plugins
panel declares a configuration seat for that: `plugins.row.config`, keyed by
`<package name>#<row id>`. The row this bundle's patch declares is
`dsh-model-safety-gate`, the same string the Host has resolved the gate's live
Config under since `0.1.7`, so the seat moved and the namespace did not: a mode,
a threshold or an audit switch saved before this release is read back by the card
after it. The tab's own seat id `model-safety-gate` was the only name left
behind, and it named nothing but the seat.

The row page renders this entry in two views. As the row's one-line description
it answers with the sentence the card's header already carries, because mounting
the form there would draw a page inside a line of text and start a second poll of
the running gate. The form belongs to the page view, and it keeps resolving its
own live configuration through the settings domain rather than taking the page's
`{ state, mutate }` view, which can neither be subscribed to nor written field by
field; that form arrives as `settingsForm` now, since the page hands its
registrant a prop called `form`.

The card keeps its shell — the standard plugin-card border, chevron and open
state — with the panel's own heading sitting above it, and the shell contract the
package gate asserts is unchanged.
