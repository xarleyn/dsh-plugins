---
"@yadsh/dsh-qa-browser": minor
---

A refused navigation reaches the operator, not only the model.

When the URL and DNS policy refused a navigation, only the model saw why: the
refusal travelled back as a tool result, the tab simply did not load, and the
person looking at the Browser panel had no way to tell a broken page from a
deployment that will not reach an intranet host. The panel now carries it.

The session records the last refusal — the policy code, the refused host, and
the refusal text, which already names the class of address and the setting that
lifts the block — and the panel renders it above the status line, with the part
the refusal cannot know: that `security.network.allowHosts` opens one host
while `security.network.allowPrivateNetworks` opens every private range to
whatever the model asks for, so the choice between them is the operator's. The
same facts are logged as `browser.policy-refused`.

The recorded gates are the ones whose refusal nobody sees: the agent's
`browser_navigate` and its history moves, plus the provider's pre-dial
validation of every redirect and subrequest — so a page that loads from an
allowed host but pulls one blocked resource also gets an explanation. The
panel's own navigation keeps answering in its error line, where the person
who typed the address is already looking. The notice clears once a navigation
the policy allows completes, so it explains a panel that is not loading rather
than accumulating history.
