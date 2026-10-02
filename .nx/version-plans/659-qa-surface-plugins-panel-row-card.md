---
"@yadsh/dsh-qa-surface": minor
"@yadsh/dsh-audit-ui": patch
---

The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section, and it paints only its body there.

The Plugins page draws the heading of a row's page itself — the crumb, the artwork and the title — and seats the bundle's configuration under it, so the card no longer competes for a place in the Settings dialog's tab strip. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-qa-surface#dsh-qa-surface`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page.

The page seats one entry in two views, and this entry answers them differently. As the page it renders the card; where the page wants the row's one-liner — the seat it falls back to for a row carrying no description — it returns a sentence, because a card mounted inside a line of text draws a page within a line and starts a second poll of the Remote. An entry the page renders without naming a view is that page rather than an empty column. The seat also hands its registrant a `form` of its own — the page's `ConfigPageForm`, which is `{ state, mutate }` alone, so it can neither be subscribed to nor written field by field — and the renderer spreads it after the injected face. The card therefore keeps resolving the full `ConfigForm` of this namespace through the settings domain, and that form crosses the boundary as `settingsForm`, where the owner prop cannot shadow it.

The row's page draws the card surface, the heading and the expand control, so the bundle stopped drawing them: the plugin's own shell — the 12 px frame, the header with the badge, and the chevron of the card contract — is gone rather than nested inside the Host's 20 px one, and the configuration sections mount directly. The route and the on/off state the header badge repeated are already in the status section, so nothing is lost with it. Focus rings now come from the Host's `--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, with each rule's own colour as the fallback, instead of a hard-coded outline the Host's `focus.css` outranks: this reaches every control the bundle paints, the row's body and the assistant's own pages alike. The disclosure arrows of the message queue, the administrator's tool list and the audit JSON tree moved off the card shell's 14 by 14 geometry onto the grid each of those surfaces already uses for its icons.

Nothing about the stored settings moves: the configuration namespace stays `dsh-qa-surface`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it.

`@yadsh/dsh-audit-ui` changes for one rule of its own — the tree disclosure arrow and the focus ring of its tab strip, both of which travel inside the `@yadsh/dsh-qa-surface` bundle and are held to the row card's contract there.
