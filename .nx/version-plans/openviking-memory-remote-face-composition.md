---
"@yadsh/dsh-openviking-memory": patch
---

The account-scoped memory page composes again, and the plugin stops disappearing
from the settings UI.

The browser half read the Remote gateway off its own context, and a Cordis
property read of a service the client face did not declare does not answer
`undefined` — it throws `cannot get property "remote" without inject`. A
throwing entry is a dead entry: the client loader reported
`failed to apply loader entry (@yadsh/dsh-openviking-memory)`, the plugin's
native card went away with it, and the whole plugin tree failed to load in the
UI. The same held one level down, for the `openvikingMemory` namespace, which is
a service of its own that only a scope that declared it may read.

The bundle now declares the gateway client in `dsh.client.inject`, so the loader
brings the gateway up before this entry applies — the ordering every other
Remote plugin in this repository declares — and it waits for the gateway service
instead of reading it, so a client that mounts no gateway keeps the native card
and a gateway that arrives later still gets its page. The mounted namespace is
read from inside the inject callback that owns it, which is also where the page
and its stylesheet are registered and torn down.
