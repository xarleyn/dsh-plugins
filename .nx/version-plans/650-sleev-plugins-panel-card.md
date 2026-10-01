---
"@yadsh/dsh-sleev": patch
---

The observer's settings card moves out of Settings and onto the Plugins panel.

Its old seat was a tab of the Host's built-in plugin section (`settings.plugins.tab`),
one page among the plugin pages Settings lists. The Plugins panel is where a bundle is
installed, switched and opened, and a row that carries configuration has a page of its
own there; the card now registers as that page, under the seat its bundle row names —
`@yadsh/dsh-sleev#dsh-sleev` in `plugins.row.config`.

What the card edits did not move. The settings namespace stays the profile entry id
`dsh-sleev`, and that id is the very row id the seat is keyed by, so the key a
deployment stores its values under is the same key the moved card reads — the seat
move cannot orphan a stored value. The four fields keep staging edits, marking the
overridden ones, resetting one field to its composition default, and refusing a
value the schema would reject. The card keeps the shared shell, and the list element
the plugin owns still holds its `<li>` root.
One thing the new seat does change: on the Settings tab a namespace that had not been
served left the tab shut, while the row's **Configure** control is drawn from the
inventory, so the same moment now answers with a line saying there is nothing to edit
instead of an empty page.

The seat's contract comes from `@deepseek-ai/dsh-client-ui-plugin-manager`: its
`plugins.row.config` entry is handed a `view` of `summary` or `page`, takes the
one-liner where the page has no description of its own, and renders the form with
its save control as the page body. Both answers are pinned by the package's tests.
Reaching the new surface is a host-side requirement, so
`compatibility.json` now names `plugins.row.config` as the client feature the browser half
needs, and `dsh.client.inject` names the module that declares the slot.
