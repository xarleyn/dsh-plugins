---
"@yadsh/dsh-qa-surface": patch
---

A turn notice speaks for a chat the reader owns, and for no other one.

`accounts.showOtherUsersChats` is a read: it puts the other accounts' chats into
the sidebar so an admin can open them. The completion notifier was handed the
sidebar's own rows, so that same switch also decided whose finished turn this
browser announces. An admin reading the shared history watched every listed chat
and got a line the moment one of them stopped answering — and with the desktop
channel on, the operating system got a notification whose title it keeps on disk,
for a turn that belonged to somebody else. Reading a chat is not being told when
its turns stop.

The account now holds the two lists apart. `ownedIds` stays what the sidebar
shows: the account's own chats plus, for an admin, every mapped one. `ownIds` is
the account's own alone, and it is what bounds a notice — the differ never sees a
chat the reader does not own, so it does not even remember that another account's
turn was running, and a chat leaving the shared view leaves no notice behind. A
chat this page claims enters both lists. A refresh re-reads the strict one: the
merged list can survive the account losing a chat whose ownership record still
names it, so it is not the proof that nothing changed.

The read scope kept everything it had. The admin's sidebar, its grouping by
owner, the author labels over foreign chats and the audit badges list exactly
what they listed before, and a deployment with the shared history off behaves as
it did — there the two lists are the same list. Nothing was made configurable
instead: another account's activity has no delivery channel here at all, and
giving it one would take a choice on the admin's side and an allowance on the
deployment's, not the read flag that happens to be on.
