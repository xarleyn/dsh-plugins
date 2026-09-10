---
"@yadsh/dsh-draft-sessions": minor
---

Rebuild the draft-sessions client on the 0.1.5 session/workspace controllers:
the client-runtime face is gone, session creation goes through the ISessions
list store with a throwing create, prompt observation rides the forwarded
api-session/status event, and workspace resolution follows the host
recent-workspace heuristic over WorkspaceSnapshot. The supported host range
moves to >=0.1.5-rc.2 <0.2.0, dropping 0.1.1-rc.2.
