---
"@yadsh/dsh-cas-results": patch
---

A rebuild leaves the tool mount behind instead of stacking a second one.

The listener and the five `dsh_cas_*` tools were registered with undo actions
collected into a local array that `dispose()` could not reach, so nothing ever
ran them: reloading the plugin left a `tools/post-execute` listener and a full
set of retrieval tools answering for a service that no longer existed, and a
second mount added another copy on top. The promises the plugin itself made
were the ones broken — its SPEC says dispose unmounts the tool surface — and the
tool runtime appearing while the service is being torn down would have mounted
into that same unreachable list.

The undo actions now live on the service, `dispose()` walks them (containing a
failure so one broken remover cannot strand the rest), and a runtime that
arrives after disposal mounts nothing.
