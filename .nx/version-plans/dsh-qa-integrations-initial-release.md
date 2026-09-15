---
"@yadsh/dsh-qa-integrations": minor
"@yadsh/dsh-qa-surface": minor
---

Introduce principal-scoped user integrations for QA Surface with an initial
read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
settings page, write-only manual webhook setup, envelope-encrypted secret
storage, per-user policy and audit records, and four narrowly scoped CRM/chat
tools whose schemas cannot select a user or credential.

QA Surface gains a public client settings-section registry and owner-attested
integration principal binding. Admin cross-user viewing, unowned sessions and
subagents do not inherit access to another account's integration.
