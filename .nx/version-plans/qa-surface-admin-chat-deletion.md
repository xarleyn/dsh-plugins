---
"@yadsh/dsh-qa-surface": minor
---

Let an administrator delete a conversation for real, and keep the sidebar's
delete what it always was — a per-browser row.

The console could read, review and rate a conversation but not remove one: the
only delete anywhere in the surface was the sidebar's, which forgets a chat in
one browser and nothing else, so a chat that should not exist (a broken
navigation, a conversation that never belonged, a user's request) stayed on the
stand forever.

The deletion is the console's, admin-only (`conversations.delete`) and audited
(`conversation.deleted`), and it removes what the deployment kept rather than a
row in a list: the stored logs of the chat and of every session delegated from
it, the ownership record that is its authorization boundary, its ratings,
reviews and queue entries, and the sources it collected. The Harness offers no
deletion seam to lean on — `sessionPersistence` has create/open/flush/stat/list,
and a live session leaves memory only with the fiber that owns it — so the
deployment's own storage artifacts are what gets removed, and the console says
so when a deployment keeps sessions somewhere directories cannot express.

Refusals come before anything is touched, so a chat is never half-deleted: a
conversation the Harness still holds open would have its log written back by
the next flush, and one it never had is not a conversation at all. Both say
which of the two they are.
