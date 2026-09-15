---
"@yadsh/dsh-qa-surface": patch
---

Materialize an account's personal skill root as soon as the account works in
its own directory, and make a refused source-bundle fetch visible. Opening the
editor and discovering skills for a session now leave
`<personal root>/.dsh/skills` behind, so a hand-made skill directory lands in a
root that already exists and the manual-edit watcher stops reporting a missing
directory on every boot of every account. The transcript's source bridge now
reports a rejected bundle fetch once per distinct reason instead of rendering
it as a chat that simply carries no sources.
