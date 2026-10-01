---
"@yadsh/dsh-jev-compaction": minor
---

The settings card opens from the Plugins page now, from the row of the plugin it configures.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
where a plugin puts a page the Host does not own. This card edits exactly one
thing — the bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
page declares `plugins.row.config`, a keyed seat rendered on the bundle's page as
the configuration section that the row's own configure control opens. The page
draws the heading of that section itself, from the row's metadata, and this
bundle's `cordis.patch.yml` declares an `id` and a `name` and no title. Read off the
harness at `0.1.7-rc.2`, the Host takes the row's display text from the bundle's own
package metadata and, when the package exports no `locale/*.json`, falls back to the
`package.json` `name` — so the words above the card are `@yadsh/dsh-jev-compaction`,
the host's fallback rather than text this card supplies. A human-readable heading
there is package metadata, which is the route `#675` opens; it is not a card edit.
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

What the card renders is the same card: the same shell every DSH configuration card
uses, the same controls, the same write-on-change behavior, the same rule that the API
key never crosses to the browser. The shell is not restyled, which is what decision D1
(option 2: our shell stays ours) recorded; whether that shell belongs inside a section
the host already decorates is the question `#646` still holds open, and this change does
not answer it. Which seat a configuration card belongs in is answered — `AGENTS.md`
names the row seat as the registration point since `#660`, and this card had been sent
to the Settings dialog by the rule that text replaced. What the move does prove is that
enforcement survives it: the gate that
decides whether the card contract applies reads the slot names a card registers under
and has listed `plugins.row.config` alongside `settings.plugin.item` since `#510`, so
it fires on the new seat for the same reason it fired on the old one. That is the
failure `docs/DSH-0.1.7-MIGRATION.md` §10 records and `#510` closed: a card that
renamed its seat used to fall out of the contract quietly.

Three details follow from the new seat rather than from a redesign. The page hands its
registrant a `ConfigPageForm`, which is `{ state, mutate }` — no subscription, no
single-field read — so the card keeps resolving its own `ConfigForm` through
`configForms`. That form arrives through the injected face under the name
`settingsForm`, which the slot's own owner prop cannot collide with, and the entry no
longer declares `form` in its props at all: a prop the code accepts and ignores reads
as a card that binds to the page's values but does not. The seat can render the same
entry a second time, as `view: 'summary'`, wherever the page wants a one-liner for a
row: it takes the row's own description first and asks the seated entry only when the
row carries none, and on the `0.1.7-rc.2` host this bundle's row does carry one — the
Host reads it from the package's `package.json` — so the sentence under the row's title
is not this card's text and nothing on the page repeats it. The entry still answers the
fallback, with the sentence and never a second card, and a test pins that. The sentence
is the shell's own description, hoisted to
`JEV_COMPACTION_ROW_SUMMARY` so the two cannot drift. And the shell's `<li>` still needs a list to sit in: measured on the
`0.1.7-rc.2` host in `#646`, the section a row opens hands its content to a plain
container with no list and no border or radius of its own, so the plugin-owned `<ul>`
stays with the card and the only shell on screen is the one the card draws.

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`: a browser running a host
without the Plugins page loses the card, and `compatibility.json` says so, its
required client features naming `plugins.row.config` where it named
`settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the slot
literal and the `@yadsh/dsh-jev-compaction#` key prefix in the shipped bundle, the
new package in the inject list). The client tests now cover the seat from both sides:
the keyed registration and the namespace it resolves, the card rendered out of the
registration with a decoy `form` handed to the seat whose `mutate` is watched, which
pins that the writes go to the injected `settingsForm` and not to the page's form, and
the summary view answering with the sentence while rendering no form at all.
The plugin's own design docs moved with the card: `docs/specs/result-shaping.md` and
`docs/RESULT_SHAPING_SPIKE.md` still described the browser seat as
`settings.plugin.item` — a slot `0.1.7` deleted, so a reader following them registers
into a surface the compiler rejects — and named the namespace by the pre-`#515`
`jev-compaction` spelling rather than the entry id the Host actually serves,
`dsh-jev-compaction`.
