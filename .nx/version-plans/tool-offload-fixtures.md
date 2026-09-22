---
"@yadsh/dsh-tool-offload": patch
---

The offload fixtures are shared instead of copied.

Each test grew its own payloads, and two of them had already drifted apart, so
a fixture that stopped matching what the plugin sends kept passing. The payloads
now live in one fixture module the suite imports.
