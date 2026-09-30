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

What the card renders is the same card: the same shell every DSH configuration card
uses (decision D1 of the cutover keeps it ours, and the card-contract gate does not
read slot names, so it fires on the new registration exactly as it did on the old),
the same six sections, the same write-on-change behavior. Two details follow from
the new seat rather than from a redesign. The page hands its registrant a
`ConfigPageForm`, which is `{ state, mutate }` — no subscription, no single-field
write, no clear-back-to-inherited — so the card keeps resolving its own `ConfigForm`
through `ctx.configForms.get(namespace)` and that form now arrives through the
injected face under the name `settingsForm`, where the owner prop called `form`
cannot shadow it. And the same entry is seated a second time, as `view: 'summary'`,
for the row's description line: the published contract of the Plugins page says the
row's heading takes "An absent description falls back to the entry's
`view: 'summary'`" (`@deepseek-ai/dsh-client-ui-plugin-manager` `0.1.7-rc.2`,
`lib/types/client/slot-contract.d.ts:105-116`), and its `RowDetail` fills that line
from `description ?? renderSlot("plugins.row.config", { view: "summary" }, …)`
(`lib/client.js:1841`), reading `description` off the row metadata alone (`rowText`
at `:211-215`) — which this bundle's `cordis.patch.yml` declares no key for, a pair
`tests/bundle.test.ts` holds at `id` + `name`. So the sentence is asked of this
entry, and it lands inside the page's `<p>`, which is why it returns text and never a
second card. The shell's `<li>` still needs a list to sit in, which the page's
configuration section does not supply, so the plugin-owned `<ul>` stays with it.

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
new package in the inject list) and refuses the old slot name, and the client tests
assert the keyed registration, the namespace the form is resolved under, and the two
views of the entry.
