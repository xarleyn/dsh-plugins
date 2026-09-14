---
"@yadsh/dsh-qa-surface": minor
---

Sign subagent completion notices with readable names instead of raw session-id
hashes. The projection resolves the settled child's delegation description from
the host session list (the same title the agents panel shows) and, when the new
`ui.subagentCodenames` switch is on — the default — signs the notice with a
deterministic adjective-noun codename («Дотошный Барсук») folded from the
session id. The real task name and the short id move into a muted meta line
inside the expanded notice, so a plaque stays matchable against the session
logs either way. Delegating agents are also asked, through a conversation
note, to give each delegation a short vivid description of its own — the
name that then shows up in the agents panel.
