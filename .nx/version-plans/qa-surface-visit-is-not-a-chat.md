---
"@yadsh/dsh-qa-surface": patch
---

Opening the QA surface no longer writes an empty chat into the history.

The page used to ask the Host for a session the moment it opened, so every visit
that sent nothing left a blank «Новый чат» line behind — six rounds on one
account were six empty rows, and the search over the history returned them. The
session was real too: the browser retained a reference to it and the account
claimed ownership of it, so the stand kept sessions nobody talked in.

A load now opens a draft, which is what the «Новый чат» button had already been
doing: nothing is created until the first prompt is sent into it
(`materializeDraft`). `ensureSessionNow` asks the browser whether it has a chat to
resume — only `browser-persistent` with a persisted id does — and takes the draft
path instead of `createQaSession` otherwise, including the case where the
persisted id names a session the Host no longer lists or a delegated child. A
fixed-policy deployment keeps its one session and cannot draft, so its bootstrap
is untouched, and so is the ladder that replaces a restored chat the current
policy refuses to attest.

Two supporting changes make the draft the same surface it was behind the button.
`enterDraft` is the tail of `startDraft` factored out, and it keeps the chat
identity when the draft on screen already names no session — taking another would
rebuild the composer over the question still sitting in it — while retiring the
send the abandoned attempt had in flight. `publish` treats a draft whose first
send created a session the stand then refused to attest as a draft rather than a
chat, because projecting that never-claimed binding leaves the composer disabled
with no retry over it; a proof still in flight keeps projecting the session its
question is waiting for.

Covered by `tests/session/session-controller-lazy-chat.test.ts` (a load spends
nothing under either policy; three visits leave no row and the first prompt leaves
one) and `tests/client/surface/qa-visit-leaves-no-chat.test.tsx` (the same over the
mounted page). The empty chats an account already has are user data and are not
touched by this change.
