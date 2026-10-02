---
"@yadsh/dsh-web-fetch-authenticated": minor
---

The settings card now opens from the plugin's own row on the host **Plugins**
page, not from a tab of the Settings "Built-in plugins" section.

The card edits exactly one thing — this bundle's own configuration — and the
Plugins page declares a seat for that: `plugins.row.config`, keyed by
`<package name>#<row id>`. The row this bundle's patch declares is
`web-fetch-authenticated`, the same string the Host files this plugin's live
Config under, so the seat moved and the namespace did not: a rule, a credential
ref, a limit or a policy saved before this release is read back by the card
after it.

The row's **Configure** control arrives with the seat. The page offers that
control only for a row whose configuration somebody registered, and until this
release no bundle registered one for this row, so the page had no way into its
settings either. The tab strip in Settings loses the tab this card added.

The chrome above the card belongs to the page. It reads the row's display
metadata from this bundle's own manifest, so the row is headed
`@yadsh/dsh-web-fetch-authenticated` with this package's description under it,
and the page draws the surface and the control that expands the section. The
card stopped drawing a second one: its border, header, chevron and open state
went, so the seat's page view is the configuration body, mounted as soon as the
page opens the row. The one fact the header's badge carried — whether the
provider is enabled — stays readable in the status section, where the provider
report states it.

The keyboard still reaches every control this card draws. The page dresses its
own elements and leaves a plugin's to the plugin, so each field, button, icon
button, switch and fold of the body takes its ring from the Host's
`--dsw-focus-ring-width` and `--dsw-focus-ring-color`. Both halves carry a
fallback: where a token is undeclared the whole `outline` shorthand would
otherwise be dropped, which is the ring vanishing rather than a plain one.

What the card shows is unchanged: the rule list, its write-only credential
fields, the network policy and limits, the connection tester, and the diagnostic
runner.
