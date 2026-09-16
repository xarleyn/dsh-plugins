---
"@yadsh/dsh-qa-browser": patch
---

Show the browser the agent is actually driving instead of an error line.

The QA panel authorizes every request against the admission boundary QA Surface
publishes as the `qaSurface` service, but the Host read that service as a plain
property while the plugin declares only `agents`, `attachments`, `tools` and
`webServer` in its injection. Cordis refuses an undeclared service read, so every
panel request — the two-second state poll, and with it the screenshot the poll
would have asked for — failed with `cannot get property "qaSurface" without
inject` before it ever reached the browser runtime. The agent kept working,
because browser tools take their session id from the execution context and never
touch that boundary; only the preview the operator watches was dead, and its
error box was the one place the refusal showed up.

QA Surface is not a declared dependency of this runtime by design — the plugin
also loads on Hosts that never mount it — so the boundary is now resolved softly
per request. A Host without QA Surface still refuses the panel, with the message
that names the missing boundary, and a Host that mounts it later is honored
without a reload.
