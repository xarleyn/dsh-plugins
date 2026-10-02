---
"@yadsh/dsh-plugin-log-ui": minor
---

The logging settings open from the Plugins page now, next to the plugin they
configure, inside the page's own card rather than a second one.

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

What the bundle renders on that seat is the body, not a card. The page draws the
surface, the row title, the row id and the description line before it mounts an
entry, so the shell this card carried — its `dsh-plugin-card*` classes, its header
with the chevron, and the plugin-owned `<ul>` that header's `<li>` needed — is gone,
together with the disclosure a user found inside the page's own expander. That is
decision D1 of §10 of `docs/DSH-0.1.7-MIGRATION.md`, reversed to "as the host does"
on 01.10 and landed through `#684`; the gate reads the seat off the built bundle and
holds a row card to the opposite half of the shell contract, so the classes that a
settings-surface card must show are the ones this bundle must not. What the chrome
used to carry still has somewhere to live: the live consumer count rides the heading
of the list it counts, and a namespace that answers `unavailable` says so in one
sentence instead of leaving an already-opened row with nothing in it.

The controls keep their behaviour and change their ring. Focus comes from the Host's
`--dsw-focus-ring-width` and `--dsw-focus-ring-color`, each half with a fallback: a
hard-coded outline of ours loses to the page's `focus.css` on specificity (0-3-2
against 0-2-0) under pointer modality, so the ring vanishes after a mouse click, and
raising specificity is the wrong repair — while a token without a fallback drops the
whole declaration where the Host has not declared it. Every control this package
draws takes the pair, the settings selects and the log panel's level chips, action
buttons, source filter and search field alike. While the namespace is unreachable the
panel no longer polls the registry either: the body that state renders shows the
reason, and nothing reads what the poll returns.

Two details follow from the new seat rather than from a redesign. The page hands its
registrant a `ConfigPageForm`, which is `{ state, mutate }` — no
subscription, no single-field write — so the card keeps resolving its own
`ConfigForm` and that form arrives through the injected face under the name
`settingsForm`, where the owner prop called `form` cannot shadow it. The same entry
is also *offered* a second render, as `view: 'summary'`: the contract lets a row
that declares no description fall back to its seat for the page's one-liner, and the
seat's published contract names exactly the two `view` values this card answers. This
bundle never takes that offer — the row's description
comes from the installed manifest's `description`, which the package declares — so
the answer is kept equal to that field and the body is mounted only for `page`.

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`. The `inject` entry is an
activation dependency of the whole client bundle, not of the card alone: a host
without the Plugins page loses the panel too, exactly as the settings-plugins entry
it replaced coupled both to that page. `compatibility.json` says which feature is
required, naming `plugins.row.config` where it named `settings.plugins.tab`.
`scripts/verify-package.mjs` asserts the new pair (the seat
literal and the `@yadsh/dsh-plugin-log-ui#` key prefix in the shipped bundle, the
new package in the inject list and on the peer list) and now asserts the chrome the
other way: the ring tokens present, and `dsh-plugin-card`, the chevron path, the
left-over list class and the old tab seat all absent. The client tests cover both
halves of the seat: the wiring suite asserts the keyed registration, the one
resolved namespace, the form arriving under a name the slot cannot overwrite, and
the ring each injected sheet puts on its controls; a rendering suite mounts the
component `apply()` registered with the page's own two prop shapes, so a level and a
format stored before the move are read back, a change is written through that
namespace's form, and the body is caught arriving with no button, no chevron and no
shell class of ours anywhere in the section. A third suite reads the seat out of the
installed host package — both of its call sites, the `view` union, the key join, and
the `description ?? …` guard that makes the `summary` call a fallback rather than the
row's normal line — so the card's answers are pinned to the host that owns the seat
instead of to a test that hands it the shape itself.
