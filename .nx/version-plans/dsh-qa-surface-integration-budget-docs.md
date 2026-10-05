---
"@yadsh/dsh-qa-surface": patch
---

The integration API now documents its answer budget as a deployment setting.

`README.md` ships inside the package, and it showed `requestTimeoutMs: 90000`
without saying what the number decides. It is not a client's patience: past the
budget the endpoint answers `200` with `escalate: true` and the `chat_id`, which
is how a ticket bridge hands a question to a human instead of retrying a turn
that is still running. A deployment that raises the budget changes when that
hand-off happens, and a bridge reading the example as a contract would wait the
wrong amount of time.

The reference now names the value as the deployment's budget, points at the
section that explains the escalation, and states the polling path
(`GET {basePath}/session` with the returned `chat_id`) for a bridge that cannot
hold one request open for the whole budget.
