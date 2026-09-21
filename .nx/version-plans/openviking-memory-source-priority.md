---
"@yadsh/dsh-openviking-memory": patch
---

Memory stops presenting itself as the first source, and stops repeating itself.

The skill's trigger claimed the tools for any task that lacked context — "or when
the task needs context this session does not have, even if nobody says the word
memory" — which is every task that has not read its file yet. A model that could
not read an attached document therefore had a description telling it that memory
was the tool for the gap, and answered with a series of `find` → `search` →
`read` → `glob` calls against the store while the document sat in the session.

The description now owns memory-specific questions only (earlier sessions, "like
last time", remembering and forgetting, where memories are filed), and the skill
carries the order of sources it was missing: the conversation and this workspace
first — attachments and documents are read with the file and document tools —
then the product documentation and the domain expert, and only then memory. Two
habits follow, matched to the failure: a miss in memory is not an answer, so a
chain of searches is not a way to find a document; and one memory round per
question is enough, because a reworded repeat returns what the first round did.

The injected block says the same thing in its own words. `RECALL_FRAMING` in the
runtime is the copy that travels with every recall envelope, whether or not the
skill was activated, and the session now delivers a block once: an identical
assembled block the conversation still carries is not injected again on the next
step. The retrieval itself is unchanged — the plugin still asks the server per
step, and the model can still search memory freely; what changed is that nothing
in the plugin recommends memory as the default place to look.
