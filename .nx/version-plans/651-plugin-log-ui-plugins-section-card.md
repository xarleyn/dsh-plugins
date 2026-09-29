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
read back by this one; the tab's own seat id `plugin-log` was the only name left
behind, and it named nothing but the seat.

What the card renders is the same card: the same shell every DSH configuration card
uses (decision D1 of the cutover keeps it ours, and the card-contract gate does not
read slot names, so it fires on the new registration exactly as it did on the old),
the same three controls, the same live consumer count, the same write-on-change
behavior. Two details follow from the new seat rather than from a redesign. The page
hands its registrant a `ConfigPageForm`, which is `{ state, mutate }` — no
subscription, no single-field write — so the card keeps resolving its own
`ConfigForm` and that form now arrives through the injected face under the name
`settingsForm`, where the owner prop called `form` cannot shadow it. And the same
entry is rendered a second time, as `view: 'summary'`, wherever the page wants a
one-liner for a row that declares no description of its own; that lands inside the
page's `<p>`, so it returns the sentence and never a second card. The shell's `<li>`
still needs a list to sit in, which the section does not supply, so the plugin-owned
`<ul>` stays with it — renamed for what it is now (`plu-tab` was a name for a pane
this card no longer renders in).

The manifest followed the surface: the client half type-imports the Plugins page's
slot contract instead of the settings-plugins one, so
`@deepseek-ai/dsh-client-ui-plugin-manager` replaces
`@deepseek-ai/dsh-client-ui-settings-plugins` as peer, dev and `dsh.client.inject`
entry — which is why this is `minor` rather than `patch`: a browser running a host
without the Plugins page loses the card, and `compatibility.json` says so, its
required client features naming `plugins.row.config` where it named
`settings.plugins.tab`. `scripts/verify-package.mjs` asserts the new pair (the slot
literal and the `@yadsh/dsh-plugin-log-ui#` key prefix in the shipped bundle, the
new package in the inject list and on the peer list), and the client test asserts
the keyed registration, the resolved namespace, and the form arriving under a name
the slot cannot overwrite.
