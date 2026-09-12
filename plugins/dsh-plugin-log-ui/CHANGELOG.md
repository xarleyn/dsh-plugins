## 0.3.0 (2026-09-12)

### 🚀 Features

- Migrate to the 0.1.5 settings surface (SettingsProvider.installSection) and ([6d2ba6a](https://github.com/xarleyn/dsh-plugins/commit/6d2ba6a))
  declare the gateway remote and renderer slot Context merges in the client
  half. The supported host range moves to >=0.1.5-rc.2 <0.2.0, dropping
  0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.1 (2026-09-06)

### 🩹 Fixes

- Prevent slot mutation while inference streams are active, validate llama.cpp ([f97114e](https://github.com/xarleyn/dsh-plugins/commit/f97114e))
  management responses, use the shared DSH home, make correction truncation
  Unicode-safe, bound miner retention and pending state, restore strict host
  type checking for session scope, pause UI polling in hidden tabs, and align
  published package metadata, compatibility declarations, and build lifecycle
  gates.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.1

### ❤️ Thank You

- xarleyn @xarleyn

## 0.2.0 (2026-08-31)

### 🚀 Features

- Add shared structured plugin logging and its settings UI, expose session-scope ([cea45a5](https://github.com/xarleyn/dsh-plugins/commit/cea45a5))
  reads through the remote API, and align plugin configuration cards with the
  native DSH settings UI. Preserve asynchronous KV streams while migrating
  logging consumers to the shared package.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.2.0

### ❤️ Thank You

- xarleyn @xarleyn