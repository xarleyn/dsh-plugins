---
"@yadsh/dsh-plugin-log-ui": minor
---

The logging card is opened from the Plugins page now, next to the plugin it configures.

The card sat as a tab of *Settings → Plugins* (`settings.plugins.tab`), which is
where a plugin puts a page the Host does not own. But this card edits exactly one
thing — the bundle's own Config — and `0.1.7` grew a surface for that: the Plugins
page declares `plugins.row.config`, a keyed seat whose entry opens as the row's
configuration section, headed by the page's own chrome. Registering there is the
difference between a settings page a user has to know the name of and a configure
control on the row they were already looking at.

The key is `@yadsh/dsh-plugin-log-ui#dsh-plugin-log-ui` — the package name joined
to the row id `cordis.patch.yml` declares. That join is what makes the move cheap
and what makes it safe: the row id is the same string the Host resolved this
plugin's volatile Config under since `#521`, so the namespace the page derives its
form from and the namespace this plugin reads are one namespace. **Nothing about
where values are stored changed**, and a level or format saved by an older build is
read back by this one. The tab left three names behind — its seat id `plugin-log`,
the `<ul>`'s class `plu-tab`, and its test id `log-tab`, now `log-card-section` — and
none of them named a stored value.

What the card renders is the same card: the same shell `AGENTS.md` requires of a card
on this seat, which the card-contract gate asserts without reading slot names, so it
fires on the new registration exactly as it did on the old; the same three controls,
the same live consumer count, the same write-on-change behavior. Two details follow
from the new seat rather than from a redesign. The page hands its registrant a
`ConfigPageForm`, which is `{ state, mutate }` — no
subscription, no single-field write — so the card keeps resolving its own
`ConfigForm` and that form now arrives through the injected face under the name
`settingsForm`, where the owner prop called `form` cannot shadow it. The same entry
is also *offered* a second render, as `view: 'summary'`: the contract lets a row
that declares no description fall back to its seat for the page's one-liner, and the
seat's published contract names exactly the two `view` values this card answers. This
bundle never takes that offer — the row's description
comes from the installed manifest's `description`, which the package declares — so
the answer is kept equal to that field, and the card's own header line is now a
sentence of its own instead of the row's one-liner repeated under the page's. The
shell's `<li>` still needs a list to sit in, which the section does not supply, so the
plugin-owned `<ul>` stays with it.

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`. The `inject` entry is an
activation dependency of the whole client bundle, not of the card alone: a host
without the Plugins page loses the panel too, exactly as the settings-plugins entry
it replaced coupled both to that page. `compatibility.json` says which feature is
required, naming `plugins.row.config` where it named `settings.plugins.tab`.
`scripts/verify-package.mjs` asserts the new pair (the slot
literal and the `@yadsh/dsh-plugin-log-ui#` key prefix in the shipped bundle, the
new package in the inject list and on the peer list). The client tests now cover
both halves of the seat: the wiring suite asserts the keyed registration, the one
resolved namespace and the form arriving under a name the slot cannot overwrite,
and a rendering suite mounts the component `apply()` registered with the page's own
two prop shapes, so a level and a format stored before the move are read back, a
change is written through that namespace's form, and the card is caught arriving
closed — its fields appear only after its own header is opened, which is what the
deployed page at `rc.2` shows. A third suite reads the seat out of the installed host
package — both of its call sites, the `view` union, the key join, and the
`description ?? …` guard that makes the `summary` call a fallback rather than the
row's normal line — so the card's answers are pinned to the host that owns the seat
instead of to a test that hands it the shape itself.

