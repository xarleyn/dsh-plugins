---
"@yadsh/dsh-qa-surface": minor
---

The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section.

The Plugins page draws the heading of a row's page itself — the crumb, the artwork and the title — and seats the bundle's configuration under it, so the card no longer competes for a place in the Settings dialog's tab strip. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-qa-surface#dsh-qa-surface`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page.

The page seats one entry in two views, and this entry answers them differently. As the page it renders the card; where the page wants the row's one-liner — the seat it falls back to for a row that declares no description of its own — it returns the sentence the card's own header carries, because a card mounted inside a line of text draws a page within a line and starts a second poll of the Remote. An entry the page renders without naming a view is that page rather than an empty column. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it.

Nothing about the stored settings moves: the configuration namespace stays `dsh-qa-surface`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it. The card keeps its own shell — the standard plugin-card border, chevron, and open state — while the page's own heading sits above it.
