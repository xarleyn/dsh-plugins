---
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-qa-surface": patch
---

Keep plugin-specific records out of Harness session journals so sessions remain
readable after a DSH restart even when linked packages resolve separate module
instances. Safety audit records now use the plugin logger with explicit session
ids, QA source snapshots use plugin-owned durable storage, and the QA package
ships a dry-run-first repair command for legacy journals with automatic backups.
