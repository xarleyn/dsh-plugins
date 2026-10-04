---
"@yadsh/dsh-openviking-memory": minor
---

The OpenViking Memory card is opened from the Plugins page now, on the row of the
plugin it configures.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
where a plugin puts a page the Host does not own. This card edits exactly one
thing — this bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
page declares `plugins.row.config`, a keyed seat whose entry opens as the row's
configuration section, headed by the page's own chrome. Registering there is the
difference between a settings page a user has to know the name of and a configure
control on the row they were already looking at.

The key is `@yadsh/dsh-openviking-memory#dsh-openviking-memory` — the package name
joined to the row id `cordis.patch.yml` declares. That join is what makes the move
cheap and what makes it safe: the row id is the same string the Host has resolved
this plugin's volatile Config under since `#516`, so the namespace the page derives
its form from and the namespace this plugin reads are one namespace. **Nothing about
where values are stored changed**, and an endpoint, a peer rule or a recall budget
saved by an older build is read back by this one; the tab's own seat id
`openviking-memory` was the only name left behind, and it named nothing but the seat.

The card keeps its six sections and its write-on-change behavior, and gives up the
frame around them. Its row is seated inside the page's own card: the page paints the
surface, the heading, the row id, the description line and the expand control, and only
then mounts this body. Until now the bundle drew a second card inside that one — a 12 px
rounded rectangle with our chevron, our open state and a badge repeating the master
switch, all of it inside the page's 20 px surface — so this plugin's row read as a
nested panel next to first-party rows. The body arrives directly now, and with the
header gone the description sentence is printed once, by the page, from this entry's
`summary` answer. The focus ring on each control the bundle draws comes from the Host's
`--dsw-focus-ring-width` / `--dsw-focus-ring-color` tokens, each with its fallback,
because `focus.css` of the Host suppresses a hard-coded outline under pointer modality
at a higher specificity than our rule had. A row whose namespace is not served to the
client says so in a sentence rather than leaving the opened section blank: a card that
owns its shell may stay invisible, one inside the page's frame may not. The owner
settled this on 2026-10-01 in #646, it landed as the contract in #684, and the
card-contract gate reads the seat off the built bundle and holds a card seated on the
row to that half.

Two details follow from the new seat rather than from a redesign. The seat spreads its
own owner prop `form` after the injected face: a `ConfigPageForm` of
`{ state, mutate }`, this same namespace's form seen through two members (`state` is
one snapshot, refreshed when the page owner renders, and there is no subscription to
take). So the full `ConfigForm` this entry resolves enters the card as `settingsForm`,
where that prop cannot overwrite it, and it is what the card follows for the values it
shows — while the writes themselves go through the page's `mutate` wherever the seat
supplies one, and through the resolved form on a seat that supplies none. `set` and
`unset` are one-op `mutate`s, so a field change keeps the revision fence, the ordering
and the recovery read it had. And the seat hands the same entry two views: `page` is
the body, `summary` is the row's one-liner, which the entry answers with the sentence
rather than with the card, because the fallback lands inside a line of the page's own
text.

The account-scoped page is untouched: it is a feature-owned QA page reached by a
browser over the network, so it keeps mounting through `qaUserSettingsSections` and
keeps the Remote namespace it reads. Only the operator's card changed seats.

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`: a browser running a host
without the Plugins page loses the card, and `compatibility.json` says so, its
required client features naming `plugins.row.config` where it named
`settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the slot
literal and the `@yadsh/dsh-openviking-memory#` key prefix in the shipped bundle, the
new package in the inject list), asserts the `summary` answer ships in the same
bundle, refuses the old slot name, and refuses the shell: a built bundle that still
carries a `dsh-plugin-card` class or the shell stylesheet fails the gate. The client
tests assert the keyed registration, the namespace the form is resolved under, the two
views of the entry, which `mutate` a field change reaches the Host through, and that
every control this body draws takes the Host's ring from both tokens with their
fallbacks.
