---
"@yadsh/dsh-jev-compaction": patch
---

Fit small decision-state budgets without a fixed five-message floor, preserve the last three privacy-bounded user messages and the task goal, and report the required protected-context budget when fitting is impossible. Bound repeated automatic failures with per-session exponential backoff while allowing manual retries and immediate recovery after configuration changes. Reduce fitting work on long histories through bounded searches.
