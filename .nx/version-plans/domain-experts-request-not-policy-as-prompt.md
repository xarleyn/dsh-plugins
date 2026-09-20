---
"@yadsh/dsh-domain-experts": patch
---

An expert's first message is the request, not the policy document.

The composed persona — base policy, domain, scope, memory, instructions and
the task — was handed to the subagent twice: once as `persona`, which the
runtime installs as a system-prompt section, and once verbatim as the child's
first `prompt`. The child therefore opened with several thousand characters of
deployment instruction reading as something the user had said, and an expert
whose whole job is separating what the caller asked from what a source claims
— the answer reviewer — had exactly the wrong material seeded as the user turn.

The profile now carries the caller's request on its own (`task`, composed by
the new `composeTask`), and the runtime receives the policy as `persona` and
the request as `prompt`. The composed preview keeps its `## Task` section, so
what an operator reads in the domain view is unchanged; only the delivery to
the child is. Background and continuable runs inherit the same split.
