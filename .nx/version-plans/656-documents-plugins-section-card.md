---
"@yadsh/dsh-documents": minor
---

The documents card opens from the Plugins page now, inside that page's own card
rather than in a frame of its own.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), the seat
a plugin takes for a page the Host does not own. This card is not such a page: it
edits exactly one thing — this bundle's own Config — and `0.1.7` grew a surface
for that. The Plugins page declares `plugins.row.config`, a keyed seat whose
entry opens as the configuration of one row, reached by that row's own configure
control. Registering there is the difference between a settings tab whose name a
operator has to remember, and a configure control on the row they were already
looking at.

The key is `@yadsh/dsh-documents#documents` — the package name joined to the row
id `cordis.patch.yml` declares. That join is what makes the move cheap and what
makes it safe: the row id is the same `documents` the Host has resolved this
plugin's volatile Config under since the `0.1.7` cutover, so the namespace the
page takes its form from and the namespace this plugin reads are one namespace.
**Nothing about where values are stored changed**, and a root, a mode or an
address saved by an older build is read back by this one. The tab's own seat id —
also `documents` — was the only name left behind, and it named nothing but the
seat.

What the card edits did not change: the same sections, the same path-addressed
writes that let a cleared field re-inherit the composition default. What it draws
did. The page renders the card surface, the row title, the row id and the
description line, and mounts the registrant's `page` view under them, so the
shell this card used to bring — `CardShell`, the canonical CSS, the
`dsh-plugin-card*` classes, the badge, the chevron and the `<li>` in a
plugin-owned `<ul>` — left the bundle: beside a first-party row it was a second
card inside the Host's one, and a heading that repeated the page's own. The
card-contract gate agrees, and now enforces it from the seat: decision D1 of the
cutover was reversed on 01.10 to "as the host does", the gate reads the seat off
the built bundle rather than trusting a declaration, and on a panel seat it
*rejects* the classes it once required. So the seat is named by a literal at the
registration, and each control the body still draws for itself — a field, a
switch, a button — takes its ring from the Host's `--dsw-focus-ring-width` and
`--dsw-focus-ring-color`, each with its fallback: where a token is undeclared the
whole `outline` shorthand would be dropped, and a hard-coded outline of ours loses
to the Host's `focus.css` under pointer modality.

Three details follow from the new
seat rather than from a redesign. The page hands its registrant a `ConfigPageForm`,
which is `{ state, mutate }` — no subscription, no single-field write — so the
card keeps resolving its own `ConfigForm` for the namespace and that form now
arrives through the injected face under the name `settingsForm`, where the owner
prop called `form` cannot shadow it. The page also draws the row's title and
one-liner itself, from the display metadata the Host reads at
`@yadsh/dsh-documents/locale/en.json` without activating the plugin, so the
package ships that file: the row is titled «Документы» — the word the tab's own
`label` used to carry — and its description is the sentence this entry answers the
seat's `summary` view with. Without the file the Plugins page names the row by its
full module name and the surface loses the only wording of its own it ever had. And
the entry answers two views: `page` is the body, `summary` is the one-liner the
page falls back to only for a row with no display description — a guard, so a row
that loses its metadata gets text inside the page's own paragraph rather than a
whole card.

The manifest followed the surface: the client half type-imports the Plugins
page's slot contract, so `@deepseek-ai/dsh-client-ui-plugin-manager` — new to
both catalogs — replaces `@deepseek-ai/dsh-client-ui-settings-plugins` as peer,
dev and `dsh.client.inject` entry, and `locale/en.json` is exported and published
so the Host can read it without activating the plugin. This is `minor` rather
than `patch` for two reasons. A browser running a host without the Plugins page
loses the card; and the card is now reached *from that page*, which reads its
inventory through `api-remotes` and reports itself unavailable on a Host without
a managed profile — a condition the Settings → Plugins tab never imposed. The
page is not the loopback-gated settings directory, so a browser on the LAN still
reaches the card. `compatibility.json` names the first: its required client
features say `plugins.row.config` where they named the tab, and its range already
starts at the release that grew the seat. The second is a consequence of the seat,
not of a version a consumer can fence on.
`scripts/verify-package.mjs` asserts the new pair (the slot literal and the
`@yadsh/dsh-documents#` key prefix in the shipped bundle, the tab seat banned so
the card cannot start rendering twice, the new package in the
inject list and on the peer list, `plugins.row.config` among the declared client
features) and that the published package carries display metadata with both fields
filled, and a new client test drives the real `apply()` against a bare context:
the keyed registration, the key built from the row `cordis.patch.yml` declares
rather than from the constant that names the namespace, the form arriving under a
name the slot cannot overwrite, the summary view staying text, and the row's
description being the sentence the entry answers with.
