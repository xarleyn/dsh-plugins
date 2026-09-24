---
"@yadsh/dsh-openviking-memory": patch
---

OpenViking memory links can no longer escape into local filesystem tools.

The `viking://` execution guard is now registered globally, so calls routed
through an agent scope are denied before `read`, `glob`, `grep`, shell, or edit
tools can reinterpret a memory URI as a workspace path. The denial points the
agent to the matching `mcp__openviking__*` tool instead.
