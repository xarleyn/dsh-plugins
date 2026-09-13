---
"@yadsh/dsh-qa-surface": minor
---

Surface provider retries and failed turns in the transcript. The Host-side
llm-retry already recovers transient provider failures, but the QA projection
rendered neither the scheduled retries nor the failure code: a dropping turn
read as a normal "Готово за N с".

Model-retry nodes now project as work-group rows: the scheduled wait counts
down live, while started and cancelled retries settle into history. Turn-error
rows render copy derived from the failure code only (a transport drop, a rate
limit, a quota or auth escalation) instead of one generic line, so raw provider
messages never reach QA-facing rows. A turn the Host ended with an error marks
its work group as failed, which the work group labels "Прервано за N с" and
styles accordingly.
