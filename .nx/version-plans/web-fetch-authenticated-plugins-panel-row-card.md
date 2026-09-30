---
"@yadsh/dsh-web-fetch-authenticated": minor
---

The settings card now opens from the plugin's own row in the Plugins panel, not from a tab of the Settings "Built-in plugins" section.

The Plugins panel draws its own card chrome — the title, the icon, and the crumb — and keeps plugin configuration out of the long tab strip that grew one clipped tab per plugin. The card registers into the page's `plugins.row.config` slot under `@yadsh/dsh-web-fetch-authenticated#web-fetch-authenticated`, the package-and-row key the page builds from this bundle's patch, so the row itself gains the configure control that opens the page. That row now also carries a line about what the plugin does: the page takes a row's missing description from the same entry, and this bundle's patch declares none, so the entry answers with the sentence the card shows under its own title.

Nothing about the stored settings moves: the configuration namespace stays `web-fetch-authenticated`, and the card keeps reading and writing through the Host form for exactly that namespace, so a value saved before this release is still there after it. The card keeps its own shell — the standard plugin-card border, chevron, and open state — while the page's own heading sits above it.
