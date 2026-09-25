---
"@yadsh/dsh-qa-surface": patch
---

The check that guards answer ratings no longer depends on how fast the machine
running it happens to be, so a loaded runner cannot report the rating path as
broken when nothing in it is.

`rating an answer from the chat surface` asked testing-library for the thumbs
button and gave the surface one second to produce it. Reaching that button is a
chain of awaited remotes — the account stage, the access profile, the session
bind and its policy attestation — and every link commits a render, so the chain
advances only when the test hands the event loop back to React. It settles in
~100 ms alone and needed 2.5 s on a runner shared by twenty project jobs, so the
second ran out while the surface was still in `creating`. The report blamed a
missing `Нравится` button, but the DOM it printed showed a chat that had not
finished opening: no message, no footer, a composer reading «Подключаюсь…».
Nothing in `QaMessage` was rendered in the wrong phase — the control is offered
for any settled, non-system message, and the surface withheld the transcript
until the bind settled, which is the behaviour the rating path depends on.

The wait is now driven by render rounds: each round is one chance for React to
commit, and the loop stops at the control it is looking for, so the rounds
needed are a property of the surface's state machine rather than a stopwatch.
The click reaches the Host on the spot, so the durable log position the rating
is filed under is asserted rather than polled, and a surface that genuinely
never settles says which phase it stopped in instead of naming a missing
button. No assertion was relaxed: the same expectation, the same `21`.

For the user the stand is unchanged.
