---
"@yadsh/dsh-answer-review-gate": patch
---

The review budget's edges are pinned by tests.

The round budget belongs to the user's turn, and the boundaries of that rule —
the last allowed round, the first refused one, a turn that ends between them —
were only exercised through the gate's own happy paths. Dedicated tests now
hold them, so a change to the budget arithmetic fails loudly instead of
drifting one round at a time.
