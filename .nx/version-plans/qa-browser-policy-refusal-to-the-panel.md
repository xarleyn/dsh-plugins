---
"@yadsh/dsh-qa-browser": minor
---

A refused destination reaches the operator, not only the model.

When the URL and DNS policy refused a request, only the model saw why: the
refusal travelled back as a tool result, the tab did not load, and the person
looking at the Browser panel had no way to tell a broken page from a deployment
that will not reach an intranet host. The panel now carries it.

The session keeps what the policy refused for the page it is on — the policy
code, whether the refused request was the page itself or something the page
asked for, the refused host, how many requests were refused, and the refusal
text, which already names the class of address and the setting that lifts the
block — and the panel renders it above the status line, with the part the
refusal cannot know: that `security.network.allowHosts` opens one host while
`security.network.allowPrivateNetworks` opens every private range to whatever
the model asks for, so the choice between them is the operator's. The same
facts are logged as `browser.policy-refused`.

The two kinds are kept apart because they are different problems. A refused
navigation means nothing opened. A refused request means the page did open and
is quietly missing an asset or an API answer — the page that looks broken
rather than the one that was blocked — and the banner says exactly that before
it names hosts. The gates that record are the ones whose refusal nobody sees:
the agent's `browser_navigate` and its history moves, plus the provider's
pre-dial validation of every request Chromium dials, told what it is gating so
the two kinds stay distinct. The panel's own navigation keeps answering in its
error line, where the person who typed the address is already looking.

The notice belongs to the tab whose page dialled the request, because that is
the page the operator is looking at: the banner explains the selected tab, the
strip marks the other tabs that carry entries, and a refusal with no page
behind it — a service worker's request — is shown beside the selected tab's own
entries. Per tab it is a list: one entry per destination, repeats counted
instead of appended, at most eight destinations, and a navigation empties the
notice of the tab that navigates without touching a second tab's explanation of
the page it is still showing. A page that keeps retrying a blocked endpoint is
one thing to fix, and a list that reshuffles as the page fails reads as noise
rather than a cause.
