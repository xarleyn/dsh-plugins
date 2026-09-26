---
"@yadsh/dsh-user-correction-miner": patch
---

A mined correction keeps the tool output that provoked it on harness 0.1.7.

The harness retired the `tool-result` content block: one tool result is now a
first-class `tool`-role message whose own `content` is the result, so the text
walker in the mining pipeline unwrapped a block the host no longer emits and
every tool result reaching a correction would have arrived as empty context. The
walker now reads the text blocks that the new message shape actually carries.

The session fixtures were rebuilt on the current vocabulary instead of patched
in place, because a fixture is the only place this package states what a session
looks like: the header is stamped from `SESSION_FORMAT_VERSION` and branded
through `SessionId` rather than hand-written at version 3, an injected
non-human message carries a real producer source kind since `plugin` is absent
from both the role and the source axes, and the tool-result fixture emits the
`tool` role with its `toolCallId`.

Two things were checked and deliberately left alone. `session.snapshotEvents()`
is still merely deprecated in the host, so the live-session path keeps its call
site, and the plugin's own `tool-result` context label — in its types, its
extractor and its durable schema — is our vocabulary around a session event that
survives, not the retired content block. A corrupt stored session, which the
host's observation reader now reports as a catchable
`SESSION_QUERY_CORRUPT_SESSION`, counts as one failed session and the scan
continues with the rest of the workspace, which the engine suite already pins.
