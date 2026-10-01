---
"@yadsh/dsh-qa-integrations": minor
---

Both Integrations cards open from the Plugins panel now, beside the plugin they
configure.

The plugin drew two cards in *Settings → Plugins* (`settings.plugins.tab`): the
operator's configuration card and the account card that holds the user's own
connections. `0.1.7` grew the surface those two belong on — the Plugins panel
declares a configuration seat for a bundle (`plugins.bundle.config`) and one for
each row the bundle declares (`plugins.row.config`) — and both cards are exactly
that: one edits this bundle's own Config, the other is this bundle's page for the
signed-in account.

The row seat is keyed `@yadsh/dsh-qa-integrations#qa-integrations`, the package
name joined to the row id `cordis.patch.yml` declares. That join is what makes the
move safe: the row id is the same string the Host has resolved this plugin's
volatile Config under, and the account seat is keyed by the package name alone, so
**no settings namespace moved**. A provider switch, a TeamCity address or a
service-credential profile saved by an older build is read back by this one. The
only names left behind are the tab's own seat ids, `qa-integrations-config` and
`qa-integrations`, which named nothing but the seat.

What the cards render is the same two cards: the same shell every DSH
configuration card uses (decision D1 of the cutover keeps it ours, and the
card-contract gate does not read slot names, so it fires on the new registrations
exactly as it did on the old), the same sections, the same write-on-change
behavior, and the same plugin-owned `<ul>` — the panel hands a configuration seat
an empty column, so the `<li>` still needs a list to sit in. Two details follow
from the new seats rather than from a redesign. The row seat hands its registrant a
`ConfigPageForm` — `{ state, mutate }` only, no subscription and no single-field
write — so the operator card keeps resolving its own `ConfigForm` through
`ctx.configForms.get(namespace)` and that form now arrives through the injected
face under the name `settingsForm`, where the owner prop called `form` cannot
shadow it. And the same entry is dispatched a second time as `view: 'summary'`
wherever the panel wants a one-liner for a row that declares no description of its
own — the contract the panel ships says so in its header ("`summary` for an
official card's one-liner or a row's missing-description fallback") and closes the
row entry with "An absent description falls back to the entry's `view: 'summary'`",
and the compiled page renders that seat beside the `page` one — so the entry
returns the sentence and never a second card. The bundle seat is documented as
`page`-only, which is why the account card has no such branch. The account card
needs no form at all — it reaches the account through the `qaUserSession` service —
so it takes the bundle's own seat, and the signed-in user's QA settings section is
untouched.

The manifest followed the surface: the client half type-imports the Plugins
panel's slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` (new to both catalogs) replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry, and `compatibility.json` names `plugins.row.config` and
`plugins.bundle.config` among its required client features where it named the tab.
That is why this is `minor` rather than `patch`: a browser running a host without
the Plugins panel loses both cards. `scripts/verify-package.mjs` now pins the two
slot literals in the shipped bundle and refuses the tab, and it glues the seat to
the patch: the namespace the operator form resolves under, the row id
`cordis.patch.yml` declares, and the key the row seat is built from must stay one
string, because a drift there is a seat with no form and a stand that reads its
saved values back as defaults — with every type check green. The list wrapper the
two cards share took the neutral name `dsh-qa-integrations__card-list` with the
mount it now draws (`dsh-qa-integrations__host-tab` named a tab that is gone). The
client tests assert the keyed registrations, the namespace the operator form is
resolved under, and the two views of the row entry. A row whose namespace the Host
does not serve now says so inside its own configuration section instead of leaving
the column empty: on a tab strip an absent card hid the tab, on a panel seat the
section is already open. `docs/DSH-0.1.7-MIGRATION.md` follows the diff — §4.2
records that the row seat is dispatched twice, §10 marks this package as the first
registration on the panel seats — both against the installed contract and the
owner's live stand. **The seat and the shell a card wears on it are not decided
here:** #646 asks the maintainer to choose between adopting the host surface and
staying on `settings.plugins.tab`, D1 option 2 stands until that answer, so
`AGENTS.md` and the `create-plugin` reference are left untouched.
