---
"@yadsh/dsh-doc-impact": patch
---

A pending impact of a rule that left the configuration stops interrupting the turn.

`ImpactState.reconcile` retired a pending record only when its rule was still
present in the fresh detection. That covered the rule that changed shape — the
new fingerprint replaced the old one — but left the other case unhandled: after
the operator switched the rule off (`enabled: false`, or `disabledRules` in
`.dsh/doc-impact.local.yml`) or deleted it, nothing produced that impact any
more, so it stayed pending for the rest of the turn. The turn kept getting
steered to update a document no active rule asks about, the reminder rounds
were spent on it, and the status command and the resolve tool went on listing
a rule the workspace no longer has.

The retirement condition is now the detection itself: a pending impact that the
current rules do not reproduce becomes `superseded`, whichever reason removed
it. Because the rule is gone, no resolve call and no edited target can satisfy
it, so the alternative to retiring it is interrupting the turn forever.

Switching the rule back on within the same turn resumes the impact. A
reappearance of the same fingerprint means the same detection is current again,
so `reconcile` adopts the fresh record instead of keeping the retired one —
while a status the agent or the operator earned (`updated`,
`reviewed-current`, `not-applicable`) still survives, exactly as it did before.
The end-to-end test switches a rule off mid-turn and reverts the file, which is
the sequence the previous behavior got wrong in both directions.
