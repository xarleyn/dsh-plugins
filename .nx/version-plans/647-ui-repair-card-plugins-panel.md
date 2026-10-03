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

The card is the settings body only. The panel's row page draws the card surface,
the heading and the expand control before it mounts this bundle into its
configuration section, so the bundle ships no outer frame, no title line, no
chevron and no list item of its own — repeating that chrome inside the Host's card
draws a second frame and a second heading next to a first-party row. What the body
does bring is a focus ring on every control it renders — its fields, its toggle and
its buttons — taken from the Host's own `--dsw-focus-ring-width` and
`--dsw-focus-ring-color` tokens, each with a fallback, because a hard-coded outline
of ours loses to the Host's focus styling after a mouse click.

The page asks this entry for two views. The body belongs to the `page` view, and it
keeps resolving its own live configuration through the settings domain rather than
taking the page's `{ state, mutate }` view, which can neither be subscribed to nor
written field by field; that form arrives in the card's face as `settings`, because
the page hands its registrant a prop called `form`. The `summary` view is answered
with one plain sentence and no store read, since the page prints it into the row's
description paragraph — a card there would draw a page within a line of text.

The row answers every state its namespace reports. Returning nothing was the right
answer for a card that drew its own frame; inside a frame the page drew, silence left
an opened row with an empty configuration section and no reason attached. So an
unavailable namespace now says the settings are not exposed to this browser session,
and a namespace that has not answered yet says so — instead of drawing the plugin's
built-in defaults as if they were the saved policy. The scan panel keeps its place in
either case: it reads the runtime rather than the settings, and rolling back temporary
repairs is the action an operator has left on a stand whose settings are closed.

Nothing else moved: the runtime, the scans, the repair actions and the write path of
every field are untouched.
