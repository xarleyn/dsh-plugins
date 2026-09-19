---
"@yadsh/dsh-openviking-memory": minor
---

The plugin gets a settings card, so its configuration is editable from
**Settings → Plugins** in the DSH web UI instead of a patch file.

The card edits the plugin's `dsh-openviking-memory` settings namespace
directly. Sections follow the configuration contract: the four automatic
context presentation knobs with the master-switch semantics spelled out, the
connection fields, peer identity, the recall knobs, capture and commit, and an
advanced group for `skipSubagentSessions`, the two timeouts and the deprecated
`captureMode`.

Writes are immediate scalar sets, and clearing a field drops the user-layer
override so the value re-inherits the composition layer — which for the
connection fields means the `OPENVIKING_*` environment variables and credential
files stay in charge. Fields marked as overridden by the profile's user layer
carry an override marker, and one reset action clears all of them. The four
knobs the schema deliberately leaves without a default render their upstream
fallback as a placeholder and write only when a value is named, so the
"configured" and "defaulted" cases stay distinguishable.

The card is configuration-only: the header badge projects the master switch
(`Auto-inject` / `Manual recall`), not live runtime state — diagnostics remain
in the plugin log.
