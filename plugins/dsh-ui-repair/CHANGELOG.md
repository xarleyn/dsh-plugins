## 0.2.0 (2026-09-12)

### 🚀 Features

- Migrate to the 0.1.5 settings surface: the settings section installs via ([458b9c2](https://github.com/xarleyn/dsh-plugins/commit/458b9c2))
  SettingsProvider.installSection under ctx.inject(['settings']) with the
  plain "ui-repair" namespace, and ctx.slots resolves through the
  client-ui-renderer merge. The supported host range moves to
  `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.

### ❤️ Thank You

- xarleyn @xarleyn

## 0.1.1 (2026-09-10)

### 🩹 Fixes

- Initial release: conservative DOM diagnostics and scoped repairs for DeepSeek ([0e4b2c3](https://github.com/xarleyn/dsh-plugins/commit/0e4b2c3))
  Harness plugin UIs. Semantic repair roots replace coupling to hashed
  CSS-module classes; R001 repeated-row icon alignment, R006 unexpected vertical
  overflow, and R007 clipped-content diagnostics run in `observe`, `suggest`,
  and conservative `auto` modes with animation-frame layout stabilization,
  verification, and rollback. Allowlisted CSS writes stay scoped by per-repair
  data attributes, bounded initial scans gain mutation-triggered targeted
  rescans, repair history stays in memory, and every owned attribute and style
  tag is restored on unload.

### ❤️ Thank You

- xarleyn @xarleyn

# Changelog

## 0.1.0 (2026-09-09)

- Add the installable host and classic-browser plugin skeleton.
- Add bounded overflow, clipping, and repeated-icon alignment diagnostics.
- Add observe, suggest, and conservative auto modes with scoped CSS writes,
  layout stabilization, verification, history, and rollback.
- Add targeted mutation rescans and unit/browser-bundle contract coverage.
- Add a persistent `ui-repair` settings section and canonical plugin card.
- Add selector/plugin/rule ignore policies and live runtime configuration.
- Add manual Suggest-mode apply/ignore actions and built-in rules R002, R005,
  R008, and R009 with opt-in guards for ambiguous layout ownership.
- Add R003/R004 row diagnostics, bounded ResizeObserver rescans, and plugin
  attribution across common stable DOM metadata.
- Add R010-R013 gap, padding, text-overflow, and parent-containment diagnostics
  with explicit ownership markers for automatic repair.
