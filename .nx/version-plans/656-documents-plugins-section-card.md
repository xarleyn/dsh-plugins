---
"@yadsh/dsh-documents": minor
---

The documents card opens from the Plugins page now, beside the pipeline it configures.

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

What the card renders is the same card: the same shell every DSH configuration
card uses (decision D1 of the cutover keeps it ours, and the card-contract gate
does not read slot names, so it fires on the new registration exactly as it did
on the old), the same sections, the same path-addressed writes that let a cleared
field re-inherit the composition default. Two details follow from the new seat
rather than from a redesign. The page hands its registrant a `ConfigPageForm`,
which is `{ state, mutate }` — no subscription, no single-field write — so the
card keeps resolving its own `ConfigForm` for the namespace and that form now
arrives through the injected face under the name `settingsForm`, where the owner
prop called `form` cannot shadow it. And the page renders this one entry a second
time, as `view: 'summary'`, wherever the row needs a one-liner — the patch
declares no description of its own — so the entry returns that sentence and never
a second card, in the same string the opened card states under its title. The
shell's `<li>` still needs a list to sit in, which the page's configuration
section does not supply, so the plugin-owned `<ul>` stays with it.

The manifest followed the surface: the client half type-imports the Plugins
page's slot contract, so `@deepseek-ai/dsh-client-ui-plugin-manager` — new to
both catalogs — replaces `@deepseek-ai/dsh-client-ui-settings-plugins` as peer,
dev and `dsh.client.inject` entry, which is why this is `minor` rather than
`patch`: a browser running a host without the Plugins page loses the card.
`compatibility.json` says so, its required client features naming
`plugins.row.config` where it named the tab. `scripts/verify-package.mjs` asserts
the new pair (the slot literal and the `@yadsh/dsh-documents#` key prefix in the
shipped bundle, the new package in the inject list and on the peer list,
`plugins.row.config` among the declared client features), and a new client test
drives the real `apply()` against a bare context: the keyed registration, the
namespace the form is resolved under, the form arriving under a name the slot
cannot overwrite, and the summary view staying text.
