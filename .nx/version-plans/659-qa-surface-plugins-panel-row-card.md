---
"@yadsh/dsh-qa-surface": minor
---

The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section.

The Plugins panel draws its own card chrome — the title, the icon, and the crumb — and keeps plugin configuration out of the long tab strip that grew one clipped tab per plugin. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-qa-surface#dsh-qa-surface`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page. The Plugins row page renders the entry with its own owner `form` seat, so the card's full `ConfigForm` — resolved through `ctx.configForms` for the same namespace — crosses the boundary renamed to `settingsForm`, and the card guards the `view` the page asks for so the form surface appears only on the page, not the summary line.

Nothing about the stored settings moves: the configuration namespace stays `dsh-qa-surface`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it. The card keeps its own shell — the standard plugin-card border, chevron, and open state — while the page's own heading sits above it.
