---
"@yadsh/dsh-domain-experts": patch
---

The child's system section carries the policy, not the task.

Splitting the prompt from the persona was only half of it: the persona the
runtime installs still ended with its own `## Task` section, so the caller's
request travelled twice — as the child's first message and inside the system
text. For the review gate that is the worst of both: the candidate answer
being reviewed, wrapped in its `<candidate_answer>` fences, sat in the system
prompt as though it were deployment instruction, while the same material also
arrived as the user turn.

`composePolicy` now builds the policy without the task section (base policy,
domain, scope, memory, delegation, domain instructions, answer contract), and
that is what the runtime receives as `persona`; `composePersona` keeps the
full document, task included, for the composed preview an operator reads in
the domain view. Background and continuable runs inherit the same policy. A
test pins both directions: the delivered text has no task section and no task
text, and the preview still shows them.
