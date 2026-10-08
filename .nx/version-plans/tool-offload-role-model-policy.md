---
"@yadsh/dsh-tool-offload": patch
---

A worker whose profile names no model follows the QA policy of the chat.

`WorkerProfileConfig` documents `provider` and `model` as `null` meaning "inherit
the parent", and the parent's model is whatever the chat was put on — including a
model a visitor picked in the interface. The runner now asks the host's QA surface
(`qa-policy.ts`, read structurally and per call, absent on a deployment with no
accounts surface) for the pair the policy fixes for the session the tool result came
from, and sends that pair only when the profile leaves `model` unset. A profile that
pins its own model is untouched, and the plugin behaves exactly as before where no
policy speaks.

Covered by `tests/integration/qa-model-policy.test.ts` (the policy pair is sent with
the parent session named, a pinned profile never asks, no policy leaves the child
inheriting, and a runner built without a policy source runs unchanged).
