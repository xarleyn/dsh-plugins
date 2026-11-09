---
"@yadsh/dsh-qa-surface": patch
"@yadsh/dsh-qa-browser": patch
---

Scope attachment access to the current chat's confirmed files and apply workspace
write limits consistently. Search within account-visible sessions, compensate
failed session creation. Coalesce
overlapping browser frame requests so slow responses can still update the panel.
