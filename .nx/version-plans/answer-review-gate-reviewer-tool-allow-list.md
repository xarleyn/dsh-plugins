---
"@yadsh/dsh-answer-review-gate": patch
---

An empty `reviewer.allowedTools` now really leaves the reviewer without tools,
and unloading the plugin closes what it opened.

The subagent backend attached a tool filter only when the allow-list was
non-empty. The host restricts a child's tools only when a filter arrives, so
`allowedTools: []` — the value that promises a reviewer working from its own
knowledge only — was precisely the one that handed the reviewer the parent
agent's whole tool surface. The list is now always sent, empty included.

The teardown paths close as well. `apply` returns an unload disposer that
closes the shared plugin logger, the one resource the plugin fiber does not
own; a review now waits for the subagent child's disposal instead of leaving it
running past the verdict; and a domain-expert review whose turn was already
cancelled at entry says so instead of launching a run it has no way to stop —
the reviewer face that plugin exposes owns the run and takes no signal.
