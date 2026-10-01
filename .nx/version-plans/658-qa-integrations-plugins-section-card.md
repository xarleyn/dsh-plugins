---
"@yadsh/dsh-qa-integrations": minor
---

Both Integrations cards open from the Plugins panel now, beside the plugin they
configure. What is proven here is the registration against the contract the panel
ships and the bundle's own renders; the click-through on a live stand stays #646's
acceptance item, because the locked QA stand answers the panel's own
`pluginManager/list*` reads with 403.

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
resolved under, and both views of the row entry — and now render the components the
two seats register out of `lib/client.js`, so a card that mounts in the source tree
but not from the bundle fails here. One of those renders answers the question the
first draft left implicit: the Plugins page spreads its own `form` *after* the
injected face, so a test clicks a switch with a decoy `{ state, mutate }` in place
and asserts the write lands on the form this entry resolved, not on the page's.
While the Host stops serving the namespace the seat renders no card, which is what
`AGENTS.md` prescribes for a panel seat — the row's own `Configure` control comes
from the inventory and stays clickable, and the plugin-owned `<ul>` remains for the
namespace to come back into. `docs/DSH-0.1.7-MIGRATION.md` follows the diff: §4.2
now says the `summary` dispatch is **conditional** on the row carrying no
description (the page renders `description ?? renderSlot(… "summary" …)`), and §10
credits `dsh-model-safety-gate` (#653) with the first landing on the panel seats and
puts this package after it. `scripts/verify-package.mjs` pins the pair the summary
answer depends on: the patch row declares no description, and the bundle carries
both the sentence and the branch that returns it. **The shell this card wears on that
row seat is no longer an open question, and this change does not settle it either:**
the owner answered #646 on 01.10 — a card on the panel's row seat takes the page's own
chrome (20 px radius, the page's focus tokens), so the plugin-owned shell stays only on
`settings.section` and `settings.plugins.tab` — and the order of that edit is the
contract first (`AGENTS.md` and the card-contract gate's asserts), then the packages in
one graph. This change therefore ships the 12 px shell it already had, unchanged, and
leaves the retarget to that graph rather than pre-empting it from one branch. The seat
is not part of the question at all: #660 landed and `AGENTS.md` names the panel seats
itself, so this change follows the file and leaves it alone.
