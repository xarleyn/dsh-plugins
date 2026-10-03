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

What the cards render is the body of the same two cards — the same sections, the
same write-on-change behavior — and nothing around it. Decision D1 of the cutover
was reversed on 01.10 and the contract has landed since (#684): on a panel seat the
row-detail page draws the card surface, the row title, the row id and the
description line before it mounts the registrant's `page` view, so our shell, our
`<li>` in a plugin-owned `<ul>`, our header with its chevron and its show/hide
label were a second frame and a second heading beside the first-party rows. They are
gone; the override marker moved from the header into the section's own toolbar,
where the reset button already counts the same keys. Two details follow from the new
seats rather than from a redesign. The row seat hands its registrant a
`ConfigPageForm` — `{ state, mutate }` only, no subscription and no single-field
write — so the operator card keeps resolving its own `ConfigForm` through
`ctx.configForms.get(namespace)` and that form now arrives through the injected
face under the name `settingsForm`, where the owner prop called `form` cannot
shadow it. And the same entry answers `view: 'summary'` with a sentence rather than
with a card, because that is where the panel puts the answer: the row's description
paragraph. The contract the panel ships names it a fallback ("`summary` for an
official card's one-liner or a row's missing-description fallback", closing the row
entry with "An absent description falls back to the entry's `view: 'summary'`"), and
which side of the fallback a live row sits on is the Host's to decide, not this
bundle's: the page takes the description from `rowText(row)` over the `row.meta` the
Host reports, so a published bundle whose package text the Host does resolve shows a
description and never dispatches the view. The branch stays for the case where
nothing resolves, and it stays a sentence there too — the *same* sentence the
manifest's `description` gives the Host, so the row reads one line whichever way the
page reaches it. `dsh-plugin-log-ui` (#651) does the same and the equality is drawn
from `package.json` by a test rather than restated as a literal, because a manifest
edit is invisible to a test that repeats the string. The bundle seat is documented as
`page`-only, which is why the account card has no such branch. The account card
needs no form at all — it reaches the account through the `qaUserSession` service —
so it takes the bundle's own seat, and the signed-in user's QA settings section is
untouched.

One answer the old chrome used to give is now the plugin's own work. The
credential-help note comes from `@yadsh/dsh-plugin-kit`, and its disclosure is the
card shell's inline chevron — the same path the panel contract forbids a row bundle
to carry, and the same block whose focus rules state a hard-coded outline that
`focus.css` out-specifies under pointer modality. Both halves therefore moved here:
the note renders from a local component that reuses the kit's
`credentialHelpView`, so the metadata shaping and the second pass over every
address stay shared and only the markup is repeated, with the disclosure drawn as
the border triangle this card's own collapsibles already use; its stylesheet is the
plugin's copy with the rings retargeted. A migrated plugin that wants the shared
note has to do the same until the kit gives the note a glyph of its own — the
twelve rows still on a settings seat are unaffected either way.

The rings are the Host's pair written out with a fallback on each half —
`--dsw-focus-ring-width` as well as `--dsw-focus-ring-color`, because a `var()` that
resolves to nothing invalidates the whole `outline` shorthand and the ring vanishes
instead of degrading — and they are on every control this bundle draws itself: the
provider fields and buttons, the service-credential checkboxes, the capability
checkboxes under their own label class, the list rows' remove buttons, the section
and group summaries, and the note's trigger and links. Nothing raises specificity
to win a ring fight. The body also stops being silent when the Host takes the
namespace away: a card that owns its shell may render nothing, but inside the page's
card an empty section is a reader with no answer, so it says so, and the row's own
`Configure` control — drawn from the inventory, not from this entry — stays
clickable.

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
saved values back as defaults — with every type check green. The client tests
assert the keyed registrations, the namespace the operator form is resolved under,
and both views of the row entry — and render the components the two seats register
out of `lib/client.js`, so a card that mounts in the source tree but not from the
bundle fails here. One of those renders answers the question the first draft left
implicit: the Plugins page spreads its own `form` *after* the injected face, so a
test clicks a switch with a decoy `{ state, mutate }` in place and asserts the write
lands on the form this entry resolved, not on the page's. The chrome is pinned the
same way it is refused: the bundle must name both seats at its `register` calls —
the contract reads the place off the registration, and a positional or
helper-passed seat leaves it only the bundle's scattered citations to decide from —
and the script now refuses the shell's show/hide labels and the plugin-owned card
list outright. What the shared gate cannot see is a control left with no focus rule
at all, which is the same user-visible failure as a hard-coded outline and a cheaper
way to reach it, so the selector list above is pinned here too, selector by
selector. `docs/DSH-0.1.7-MIGRATION.md` follows the diff: §4.2 says the `summary`
dispatch is **conditional** on the description the Host reports for the row — the
page renders `description ?? renderSlot(… "summary" …)`, and that description is
`rowText(row)` over `row.meta`, the Host's inventory, not `cordis.patch.yml` — §3's
row for this package stops describing a shell it no longer draws, and §10 carries
the line's own D1 as option 1, with `dsh-model-safety-gate` (#653) and this package
named as the two rows that landed on the panel seats.
