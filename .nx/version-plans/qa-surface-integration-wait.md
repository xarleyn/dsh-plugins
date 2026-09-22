---
"@yadsh/dsh-qa-surface": patch
---

An integration may wait as long as its operator allows.

`integration.requestTimeoutMs` was validated inside a fixed window whose ceiling
was ten minutes, and that ceiling was not a budget the deployment spends: nothing
in the plugin pays for a longer wait. It only cut off the questions an
integration exists for — a long analysis came back as an escalation while its
answer was still being written. The floor stays (five seconds: a shorter wait is
not a wait), the ceiling is gone, and the refusal message says so. A deployment
that wants thirty minutes now writes `requestTimeoutMs: 1800000` and gets
thirty minutes.
