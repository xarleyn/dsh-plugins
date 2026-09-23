---
"@yadsh/dsh-openviking-memory": minor
---

The account-scoped page shows what the memory holds instead of switching it.

The "Память" page in the QA settings dialog was a copy of the deployment's own
switches, handed to whoever opened it. Those switches decide whether the
assistant uses the memory at all, which is the deployment's decision, taken
where the deployment's configuration lives — so the page no longer writes
anything. What it does instead is answer the question a person actually has
about their memory: the profile the store keeps about the account, the sections
it files memories under, and the conversations it learned from, all read
through the client that speaks as that account.

The account boundary now fails closed. The account travels as
`X-OpenViking-User`, and a store in API-key mode strips that header and answers
as its own user; if the store does not confirm the requested account, the Remote
returns no profile, memories or session summaries and the page explains why the
content is hidden. A stale response for a previous account can no longer replace
the current page, and unloading or hot-reloading the client releases its Remote
mount. Totals are calculated before the browser list is shortened and say when
the server-side listing limit prevents an exact total.

The Remote surface shrinks to one read-only method (`userMemoryOverview`);
`setUserMemorySettings` and `resetUserMemorySettings` are gone, and the
per-account plan overrides they wrote are now an operator's lever in
`openviking-memory-qa-users.json` only. The operator's own configuration card is
untouched.
