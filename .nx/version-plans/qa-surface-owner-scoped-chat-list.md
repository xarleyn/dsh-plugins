---
"@yadsh/dsh-qa-surface": patch
---

The chat list is the account's own, and a chat opened after login appears at
once.

With accounts on, `QaSessionController.chatIds()` unioned the server's owned
list with the browser-local chat index. The index is what a browser
accumulated, not an identity: on a shared browser it still holds the chats the
previous visitor started, and every one of them was listed — title, timestamp,
running spinner, audit badge — beside the account's own. An account whose owned
list was still empty listed the index alone, so the fresh sign-in saw someone
else's chats and their live activity. The union also carried the case it was
there for: a chat created after login is claimed on the Host but was never
added to the owned list, so it stayed listed only through the index.

The owned list is now the list. `claimNewSession` records the claimed id in the
snapshot, so a chat created or reopened under the account enters it without a
reload (a claim the Host answers with a conflict stays out; a claim that never
reached the Host still enters, because the binding already passed the
attendance boundary, which claims an unowned chat for whoever asks first and
refuses another account's). Deployments without accounts are unchanged: the
index is the list, as before.

`subagentNames()` read the deployment-wide session list — every chat's
delegations, catalogs included — to sign settlement notices. It now reads only
the chats this page lists: `visibleSubagentCandidates` resolves a delegated
session to the chat it belongs to through its parent chain (`chatRootOf`, so a
nested child is not mistaken for a chat of its own) and keeps children of the
visible chats alone.

Verification: `pnpm nx test dsh-qa-surface` (1253 tests, 185 files),
`pnpm nx run dsh-qa-surface:typecheck`, `pnpm nx run dsh-qa-surface:lint`.
`tests/session-chat-ownership.test.ts` fails against the previous `chatIds()`
on both list cases; `tests/accounts-controller-actions.test.ts` covers the
claim path.
