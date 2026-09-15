## 0.1.0 (2026-09-15)

### 🚀 Features

- Introduce principal-scoped user integrations for QA Surface with an initial ([0bf810f](https://github.com/xarleyn/dsh-plugins/commit/0bf810f))
  read-only Bitrix24 provider. The plugin adds a first-class Russian Integrations
  settings page, write-only manual webhook setup, envelope-encrypted secret
  storage, per-user policy and audit records, and four narrowly scoped CRM/chat
  tools whose schemas cannot select a user or credential.

  QA Surface gains a public client settings-section registry and owner-attested
  integration principal binding. Admin cross-user viewing, unowned sessions and
  subagents do not inherit access to another account's integration.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-qa-surface to 0.6.0
- Updated @yadsh/dsh-plugin-log to 0.3.1

### ❤️ Thank You

- xarleyn @xarleyn