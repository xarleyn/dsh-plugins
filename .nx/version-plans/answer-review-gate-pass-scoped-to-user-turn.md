---
"@yadsh/dsh-answer-review-gate": patch
---

The review round budget and the PASS receipt now belong to the user turn, so a
reviewed answer stops being reviewed.

Both were keyed by the agent turn the boundary reported. Agent turns are not
user turns: one request spends several of them, because a REVISE steer continues
the current turn while the primary's next version — or a settlement notice —
reopens the boundary as a new one. Every such change therefore discarded the
receipt of a candidate the reviewer had already passed and handed the gate a
fresh round budget. The result was the reported exchange: the reviewer passed an
answer, the model wrote one more version announcing the review, and that version
was reviewed again instead of shipping, with the round limit never reached
because each turn reset it.

The gate now keys its session state by the user request the candidate answers —
the surface sequence of the latest real user message — and keeps the round
counter, the one-per-turn failure steer and the PASS hash there. The agent turn
only refreshes the turn number used for delegation bookkeeping. An unchanged
candidate is never reviewed twice, not even in a later agent turn of the same
request; a candidate that changes after a PASS is reviewed once, as any changed
candidate is; and the revision budget is spent by the request, so `open`/`warn`/
`closed` failure handling takes over after `maxReviewRounds` revisions of that
request instead of starting over. A new user message owns a new budget and no
longer inherits the previous request's receipt, while a boundary that finds no
candidate cannot reset a known budget.

The reviewer tasks also state the contract that made the loop look reasonable
from the model's side: a pass is final for the candidate it reviewed, it ships as
written and asks for no further version.
