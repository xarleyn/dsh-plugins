---
"@yadsh/dsh-session-audit": patch
---

Internal cleanup: the host pipeline test monolith is split into registry,
scanner, security and service domains with shared helpers, and the package gains
a design note for its QA-surface integration. No runtime behavior changed.
