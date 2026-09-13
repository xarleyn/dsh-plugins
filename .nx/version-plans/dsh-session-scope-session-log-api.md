---
"@yadsh/dsh-session-scope": patch
---

Read the session log through the 0.1.5 API so any turn can start. Session
format v3 replaced the `session.events` array with `snapshotEvents()`, and the
plugin still read the removed property. `getScope` resolves the effective scope
from that log on the very first line of the plugin's prepended `agent/pre-step`
listener, so the read threw `Cannot read properties of undefined (reading
'length')` before the step began: every turn in a host that mounts this plugin
ended as `turn/end {kind:'error'}` without reaching the model. The structural
`ScopeSession`/`DelegatedScopeSession` interfaces now declare `snapshotEvents()`
instead of the field, the four call sites use it, and the test fakes expose the
log through the same method.
