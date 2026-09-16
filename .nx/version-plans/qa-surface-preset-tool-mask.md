---
"@yadsh/dsh-qa-surface": patch
---

Keep the tools a deployment's agent preset mounts. `tools.restrict()` filters
the names a scope INHERITS — the global layer and the ancestor layers, which is
where a preset's own tool rows live — and the previous release built that list
from the global layer alone. Every tool the QA agent preset mounts (the
filesystem, web, subagent and named-expert tools) therefore dropped out of the
mask and left the model surface: the account-free path refused the session with
`unknown-tools` naming exactly those tools, and a role-based session answered
the browser's policy proof with the shortened list, which the browser rejects as
a mismatch. The mask now leaves out only the names the QA tool catalog registers
on the agent itself — no restriction can name those — and gives up whatever else
the registry refuses, so one unnameable entry costs that entry instead of the
whole call and the whole chat. The proof reports the deployment's pinned list
again, which is the list the browser compares it against, rather than a role's
effective one.
