---
"@yadsh/dsh-qa-surface": minor
---

Harden the gated QA experience and make cross-user history explicitly
opt-in. A new `accounts.showOtherUsersChats` setting defaults to `false`, so
administrators only see their own chats unless the deployment enables the
shared ownership view. Account storage now follows external CLI updates and
uses process-scoped temporary writes, while session admission and client state
handling avoid stale async results and reset session-bound assets reliably.

The QA client now presents a dedicated test-interface disclosure, improves
chat search and owner matching, keeps row actions from disturbing result
layout, distinguishes administrator roles, and removes decorative middle-dot
separators from the sidebar, messages, and source details.
