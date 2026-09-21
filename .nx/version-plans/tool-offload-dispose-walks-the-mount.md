---
"@yadsh/dsh-tool-offload": patch
---

A reload no longer leaves the offload listener running.

The `tools/post-execute` listener was registered with its undo action pushed
into a local array that `dispose()` never saw, so the plugin's own promise —
"unload/reload leaves tool execution unchanged, listener registration is
disposed symmetrically" — was not kept: a reloaded service could not remove the
previous listener, and the runtime arriving during teardown would have mounted
into the same unreachable list.

The undo actions now live on the service, `dispose()` walks them, and a runtime
that arrives after disposal mounts nothing.
