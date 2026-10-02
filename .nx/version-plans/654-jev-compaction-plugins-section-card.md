---
"@yadsh/dsh-jev-compaction": minor
---

The settings card opens from the Plugins page now, from the row of the plugin it configures.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
where a plugin puts a page the Host does not own. This card edits exactly one
thing — the bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
page declares `plugins.row.config`, a keyed seat rendered on the bundle's page as
the configuration section that the row's own configure control opens. The page
draws the heading of that section itself: the contract heads the entry's page with
the plugin's display title and description, and the row's title resolves out of the
row's Host-supplied metadata with the row's full module specifier as the final
fallback (`presentation.d.ts`, `rowText`). This bundle's `cordis.patch.yml` declares
an `id` and a `name` and no title, and the row's module is the package itself, so the
words above the card are `@yadsh/dsh-jev-compaction` — the host's fallback rather than
text this card supplies. Making that heading human-readable is package metadata's
job, which is the route `#675` opens; it is not a card edit.
Registering here is the difference between a settings page a user has
to know the name of and a configure control on the row they were already looking
at.

The key is `@yadsh/dsh-jev-compaction#dsh-jev-compaction` — the package name joined
to the row id `cordis.patch.yml` declares. That join is what makes the move cheap
and what makes it safe: the row id is the same string the Host resolved this
plugin's volatile Config under since `#515`, so the namespace the page derives its
form from and the namespace this plugin reads are one namespace. **Nothing about
where values are stored changed**, and a threshold, a provider or an archive knob
saved by an older build is read back by this one; the tab's own seat id
`dsh-jev-compaction` and its `label`/`order` were the only names left behind, and
they named nothing but the seat.

What the card renders is the body of a card the page frames, and the same controls, the
same write-on-change behavior and the same rule that the API key never crosses to the
browser. A row on the Plugins panel sits inside the page's own card: the page paints the
surface (a 20 px `--dsw-radius-xl` one), the row title, the row id, the module name and
the description line, and mounts the registrant's `page` view under them. This bundle
drew a second card inside that — a 12 px rounded rectangle with our heading, our
chevron and a show/hide button duplicating the page's own toggle — which is the nesting
`#646` was opened for and the maintainer settled on 01.10 as option 1 of
`docs/DSH-0.1.7-MIGRATION.md` §4.3, in the line as `#684`. `CardShell` and the
plugin-owned `<ul>` that kept its `<li>` a list item are gone, the header badge that
summarized the same enabled and shaping state the status block carries went with the
header, and the configuration sections mount directly.

The focus rings of the controls this plugin paints come from the Host's design system
(`--dsw-focus-ring-width` / `--dsw-focus-ring-color`) rather than a hard-coded outline,
and each half carries its own fallback: an undeclared token invalidates the whole
`outline` shorthand, so the ring would disappear instead of degrading, while a hard-coded
outline of our own loses to the Host's `focus.css` under pointer modality at 0-3-2 against
our 0-2-0 — raising specificity to win that fight is the wrong repair, and no rule here
raises it. Every control the bundle renders gets the ring, not one of them: the fields,
the toggle, the chip-remove button, the buttons, and the Advanced disclosure.

Which seat a configuration card belongs in is answered — `AGENTS.md` names the row
seat as the registration point since `#660`, and this card had been sent
to the Settings dialog by the rule that text replaced. What the move does prove is that
enforcement survives it: `scripts/verify-package-hygiene.mjs` has fired the card contract
on `plugins.row.config` since `#510`, and since `#684` the half that contract applies is
decided by the seat the *built bundle* registers on — the shell it requires of a
settings-surface card is exactly what it forbids on the row. That is why the seat is now
stated as a literal inside the `slots.register` call instead of behind the
`SETTINGS_CARD_SLOT` constant it used to sit in front of: a constant still resolves, but a
positional registration leaves the gate falling back on every seat name the bundle quotes,
where a surviving comment could decide the contract after all. Stating it in the call is
what keeps the row's half of the contract in charge of this bundle. The failure
`docs/DSH-0.1.7-MIGRATION.md` §10 records — enforcement keyed off one slot literal, so a
card that renamed its seat used to fall out of the contract quietly — was closed by `#510`
and is now closed by the seat-aware gate itself.

Three details follow from the new seat rather than from a redesign. The page hands its
registrant a `ConfigPageForm`, which is `{ state, mutate }` — no subscription, no
single-field read — so the card keeps resolving its own `ConfigForm` through
`configForms`. That form arrives through the injected face under the name
`settingsForm`, which the slot's own owner prop cannot collide with, and the entry no
longer declares `form` in its props at all: a prop the code accepts and ignores reads
as a card that binds to the page's values but does not. The seat also accepts the entry
as `view: 'summary'`, the row's one-liner, and asks for it only when the row carries no
display description of its own: that description is Host inventory data, resolved out of
the row's supplied metadata (`presentation.d.ts`, `rowText`), so nothing in this bundle
decides whether the fallback ever fires and this change neither claims nor needs that
answer. What the bundle owns is the answer's shape — the sentence, never a second body —
and two tests pin it, one against the entry and one against the compiled bundle. The
sentence lives in `JEV_COMPACTION_ROW_SUMMARY`, exported so the bundle test compares the
compiled answer against the source rather than against a copy of it. And with no header of
ours left to hide, an unavailable namespace no longer renders nothing: a card that owns its
shell can stay invisible, while this one sits inside a row the page has already expanded,
so leaving its section empty would tell the reader nothing. It answers with the line that
says why no values show.

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`: a browser running a host
without the Plugins page loses the card, and `compatibility.json` says so, its
required client features naming `plugins.row.config` where it named
`settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the slot
literal and the `@yadsh/dsh-jev-compaction#` key prefix in the shipped bundle, the
new package in the inject list) and then runs the shared card contract over
`lib/client.js`, which on this seat means the bundle must carry no `dsh-plugin-card`
class, no chevron path, and a ring built from both Host tokens. The client tests now
cover the seat from both sides: the keyed registration and the namespace it resolves, the
card rendered out of the registration with a decoy `form` handed to the seat whose `mutate`
is watched — arriving after the injected face, which is the order the seat really renders
its owner props in — which pins that the writes go to the injected `settingsForm` and not
to the page's form, the body mounted with no expand step and no list item or disclosure
control of ours around it, the `summary` view answering with the sentence and no body, once
out of the entry and once out of the compiled `lib/client.js` against a section that serves
no values at all, and — against that compiled text — the seat named inside the registration
and the shell and chevron absent from it.
The plugin's own design docs moved with the card: `docs/specs/result-shaping.md` and
`docs/RESULT_SHAPING_SPIKE.md` still described the browser seat as
`settings.plugin.item` — a slot `0.1.7` deleted, so a reader following them registers
into a surface the compiler rejects — and named the namespace by the pre-`#515`
`jev-compaction` spelling rather than the entry id the Host actually serves,
`dsh-jev-compaction`.
