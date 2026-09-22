---
"@yadsh/dsh-kv-persist": patch
---

A route key's separator no longer makes the file binary.

`manifestRouteKey` joined the provider and the model with a literal NUL byte.
Git reads such a file as binary: the diff of `snapshots/manifest.ts` became
"Binary files differ", so a change to how keys are composed could not be
reviewed at all. The separator is now the same character written as an escape,
the key is byte-for-byte what it was, and the file diffs as text again.
