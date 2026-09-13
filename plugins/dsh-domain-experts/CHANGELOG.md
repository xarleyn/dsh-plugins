## 0.1.0 (2026-09-13)

### 🚀 Features

- Initial release of the Domain Experts plugin. A domain is a persisted expert ([dc6ad70](https://github.com/xarleyn/dsh-plugins/commit/dc6ad70))
  profile — persona, filesystem and knowledge scope, memory namespace, tool
  policy, cross-domain policy and model policy — created in a new
  `Settings → Plugins → Domain Experts` tab. Experts run as ordinary DSH
  subagents through the native runtime, so the plugin composes the request
  instead of re-implementing agent execution. The plugin reports every
  restriction as either enforced or advisory, so a filesystem rule is never
  presented as isolation it does not have. Cross-domain questions go through the
  owning expert, with a machine-enforced mode, target list, depth cap and
  parallel budget; memory is partitioned by namespace at the storage-key level.
  Scope providers, memory backends and workers are public extension seams.

### 🧱 Updated Dependencies

- Updated @yadsh/dsh-plugin-log to 0.3.0

### ❤️ Thank You

- xarleyn @xarleyn