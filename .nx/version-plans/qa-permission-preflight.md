---
"@yadsh/dsh-qa-surface": patch
---

Validate the pinned Workspace and permission preset before creating a durable
QA session. Creation failures now retain a coarse `permission-preset` or
`workspace-unavailable` reason for browser diagnostics without exposing Host
details, and failed attestation no longer marks a session as trusted. Existing
chats whose recorded composition predates a deployment config change remain
available as read-only transcripts while new chats use the current policy.
