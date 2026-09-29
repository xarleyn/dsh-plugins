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
`dsh-sleev`, because the namespace is where a live deployment already stored its values:
a stand that saved `sleev-a` as an observed route before this release reads `sleev-a`
after it. The four fields keep staging edits, marking the overridden ones, resetting one
field to its composition default, and refusing a value the schema would reject. The card
keeps the shared shell, and the list element the plugin owns still holds its `<li>` root.

The page asks a configuration entry for one of two views, and the card answers both: the
row's one-liner is the card's own description, and the form with its save control is
rendered only for the page view. Reaching the new surface is a host-side requirement, so
`compatibility.json` now names `plugins.row.config` as the client feature the browser half
needs, and `dsh.client.inject` names the module that declares the slot.
