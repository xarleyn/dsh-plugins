---
"@yadsh/dsh-answer-review-gate": minor
---
New plugin: an independent answer review gate. Before a candidate final answer
completes its turn, a configurable reviewer (a dsh-domain-experts domain or a
native subagent child) checks it and can send findings back for a corrected
candidate within bounded rounds. Interim turns that close while the session's
background delegations are pending are never reviewed; a review PASS applies
to the exact candidate content; reviewer failures follow the configured
failure policy (`open`/`warn`/`closed`) and are never reported as passes.
