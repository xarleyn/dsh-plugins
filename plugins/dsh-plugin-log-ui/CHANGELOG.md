## 0.4.0 (2026-09-13)

### 🚀 Features

- A **Plugin logs** panel in the host's right Sidebar, next to the settings card ([9a7536b](https://github.com/xarleyn/dsh-plugins/commit/9a7536b))
  it already shipped. The panel streams what the plugins are writing right now:
  a source filter over every registered plugin logger, level filters from `trace`
  to `fatal`, and a text filter over the whole line, with severity colouring that
  keeps quiet levels quiet and puts the warn, error, and fatal inks where a reader
  looks for them. Output follows the newest line until the reader scrolls up, can
  be paused, and says so explicitly when the host buffer dropped lines the panel
  never read, instead of leaving a silent gap.

  The panel's stylesheet is injected under its own key rather than the card's:
  `injectCardStyles` treats a key it has already seen as injected, so sharing one
  key between two sheets drops the second one — the settings card rendered with no
  rules of its own until each sheet got its own tag.

  The host half subscribes to the record bus of `@yadsh/dsh-plugin-log` and serves
  `pluginLogUi.tail(cursor, limit)` from a 2000-record ring buffer, rendering each
  record's fields to bounded strings because the Remote boundary carries plain
  JSON. The panel opens from the right Sidebar's guide page, which is how a tab
  type is reached, and needs the `sidebarRightTabs` service and the
  `sidebar.right.pane.tab` seat, both now declared as required client features.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn

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