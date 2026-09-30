---
"@yadsh/dsh-web-fetch-authenticated": minor
---

The settings card now opens from the plugin's own row in the Plugins panel, not
from a tab of the Settings "Built-in plugins" section.

The card registers into the page's `plugins.row.config` slot under
`@yadsh/dsh-web-fetch-authenticated#web-fetch-authenticated` — the package-and-row
key the page builds for the row this bundle's patch declares. That registration is
what puts the row's **Configure** control on the page: the control is gated on the
keys registered into the slot, so a row nobody registers has no way into its
configuration, and this row had none before the move. The card also leaves the
settings tab strip, where every plugin that registers adds one more tab.

The page owns the chrome around the card: its crumb back to the package, its
heading, and the technical lines under them. A heading the page cannot resolve from
Host metadata falls back to the module specifier, and row artwork appears only
where Host metadata declares an icon — a third-party patch row declares neither, so
the row reads as `@yadsh/dsh-web-fetch-authenticated` above the title our card
draws for itself. What the row says about the plugin is now this entry's answer
too: the page takes a row's missing description from the entry's summary view, so
the same registration gives the row its one line. The card's header keeps a
different sentence, because the page prints that summary one paragraph above the
card and repeating it showed the same line twice on one screen.

The page reads the host's plugin inventory to draw any of this, so a deployment
that keeps the plugin-manager services to the operator's own session has no Plugins
page for a remote browser. The declarative profile config edits the same settings
and stays available there.

Nothing about the stored settings moves: the configuration namespace stays
`web-fetch-authenticated`, and the card keeps reading and writing through the Host
form for exactly that namespace, so a value saved before this release is still
there after it. The card keeps its own shell — the standard plugin-card border,
chevron, and open state — inside the page's configuration section, which supplies
no list of its own, so the shell's `<li>` still rides in a list this bundle owns.
