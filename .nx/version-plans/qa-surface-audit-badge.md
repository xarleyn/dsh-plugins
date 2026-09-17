---
"@yadsh/dsh-qa-surface": minor
---

A chat that has been audited now says so, and opens the audit.

The chat list carries a badge on every row whose session has an audit: a check
mark and the verdict, with the finding counts on hover. Clicking it opens a
dialog with the same three views the ordinary DSH session shows — report,
findings, JSON — over the surface's own shell. The badge and the verdict are
deliberately two things: the check says an audit exists, the verdict and counts
say how it went, so a green tick beside "poor" reads as "audited, and it went
badly" rather than as approval.

The surface does not scan, watch or index anything to do this. It asks the
session-audit plugin, which owns the only audit registry, through one optional
Remote namespace; when that plugin is not installed the namespace never
resolves, and the rows render exactly as they did before — no badge, no empty
state, no other change. Nothing in the surface imports the audit plugin, and the
audit plugin knows nothing about this one.

Loading is two-step and lazy. The badge costs one summary read per listed chat
on a slow poll, which is a map lookup on the host; the report and the analysis
are fetched only when a dialog opens, and the JSON tree is built only when its
tab is selected. A provider that is slow or absent degrades to a sidebar
without badges rather than a sidebar that waits.
