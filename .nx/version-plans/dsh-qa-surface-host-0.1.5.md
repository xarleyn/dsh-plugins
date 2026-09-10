---
"@yadsh/dsh-qa-surface": minor
---

Rebuild the client on the 0.1.5 surfaces: the transcript projects from the
ui-chat conversation view's legacy slice, chat/model pinning moves to the
wire remotes (`agentPresets.select` on the still-blank session, then
`session.selectModel`) with the attestation ordering preserved, and
history reads go through the session-v3 surface. The supported host range
moves to `>=0.1.5-rc.2 <0.2.0`, dropping 0.1.1-rc.2.
