---
"@yadsh/dsh-qa-surface": minor
---

A user can change their own password, and a forgotten one has a way back in.

The store already had everything an operator needs — `setPassword` with its
token-version bump, `validatePassword`, the sign-in rate limit — but nothing
reached the person who owns the account. Somebody who suspected a leaked
password had no action to take, and somebody who had forgotten one had no path
at all: the only way back in was an operator with shell access running
`qa-accounts set-password`.

`changePassword(token, current, next)` is the self-service half. It verifies the
current password, applies the same strength gate as registration, and bumps the
token version — which signs every *other* browser out, the point of a change
after a leak — then answers with a freshly minted token, so the browser that
made the change is not signed out by its own write. `accountsChangePassword` is
its Remote, and the settings dialog gains a "Пароль" section: current, new, and
the repeat that catches a typo in a field that cannot be read back later.

A forgotten password has no mail transport on this stand, so the way back is a
request an operator answers. `requestPasswordReset(email)` is deliberately
indifferent: a known address, an unknown one and a disabled account all take the
same path out, and the attempt spends the same authentication budget as a
sign-in — so the screen can be used neither to learn which accounts exist nor to
flood an operator's queue. Real requests land in a new `qa_password_resets`
table (schema migration 2), one row per account with a repeat count, and the
sign-in card grows the "Забыли пароль?" path that says the same thing to
everybody. A change made by the account-holder clears their own pending row,
because it answers the request.

The operator reads that queue in the admin console's "Пользователи" page and
answers it there: `adminPasswordResetRequests` (users.read) lists it,
`adminResetPassword` (users.manage) sets the new password, drops the row and
writes a `user.password-reset` audit event. The queue renders only while
somebody is waiting — a permanently empty panel teaches operators to ignore it,
and this one has to be noticed, because a reset ends every session of that
account and the new password must be handed over deliberately.
