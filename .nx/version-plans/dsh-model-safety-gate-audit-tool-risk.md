---
"@yadsh/dsh-model-safety-gate": patch
---

Keep tool-call checks strictly observational in audit mode. Findings are still
scanned and recorded, but accumulated turn risk can no longer turn an audited
tool call into an approval request or denial.
