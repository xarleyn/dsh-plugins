---
"@yadsh/dsh-qa-surface": minor
---

Stop a delegated child from being a chat anywhere in the QA surface.

A subagent's session is an implementation detail of one answer: it has no QA
owner, the Host refuses to attest it, and its sources reach the parent chat
through the provenance inheritance flow. Nothing enforced that on the way into
the chat list, though. The browser hands the Host a session id whenever it
binds one — including a subagent transcript, which the surface opens read-only
— and the id lands in `ensureSessionAccess`, whose first-come claim ran before
anything could tell a child from a fresh chat. A child from an earlier Host run
is not materialized when a browser first presents it, so its header was
unknown, the claim was recorded, and from then on it rendered as an ordinary
chat row: the delegated task's title, a transcript that is a subset of the
parent's work, and no way to send into it. A deployment that ran an affected
release carries one such record per subagent transcript someone opened.

Three layers close this, each answering a different question:

The client projection asks the one that matters to a reader — `isDelegatedSession`
reads the two marks the host list already carries (`origin`, `parentId`) and the
sidebar, the chat counter in the account settings and the claim batch all use
it, so a chat row, a chat count and a migrated index cannot disagree about what
a chat is. The members list also refuses a stored id that resolved to a child:
restoring one, or switching to one through a stale browser index, forgets the
entry instead of opening a subagent's transcript as chat history.

The Host refuses to write the record in the first place: `QaAccessService.claimSessions`
filters a browser's legacy chat index before the store sees it, keeping the
lineage check on the side that can answer it (`QaAccessService.isDelegatedChild`:
the live registry for a running child, the cached durable listing for one that
finished).

And the records already written are reclaimed. `pruneDelegatedOwnership` drops
ownership rows for ids the Host positively identified as children — no grace
period, because a chat is never a child, but no guessing either: a listing that
cannot be read reclaims nothing. The sweep is throttled, runs off the
reservation path next to the vanished-session sweep, and remembers the listing
so later refusals need no second read.

One more artifact of the same family goes away: a refused `createSession` used
to keep its ownership reservation once the Host session existed, so every
refusal (an unmounted tool, a permission preset that no longer resolves) left
an empty "Новый чат" row in the account's list that nothing could remove — the
browser's delete only forgets it locally, and the record brought it back. The
reservation is now released on any failure: the browser never learned the id,
so no chat can exist under it.
