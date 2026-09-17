---
"@yadsh/dsh-qa-surface": minor
---

Give a parked question the composer, and make sure it never outlives its turn.

While a question from `ask_user_question` was on screen, the composer stayed
next to it and accepted typing: a send was refused only because the turn looked
busy, and a turn whose snapshot stopped reporting as running left an empty field
that looked ready while the model kept waiting for an answer to the form above
it. The form now takes the composer's place for as long as the request is
parked, and the composer is hidden behind it rather than unmounted so the draft
the operator had typed is still there when the answer is sent. The run's own
stop moved into the form's header, so ending the turn instead of answering
stays possible, and `interaction.questions` accepts `enabled` as the same value
as `interactive`.

A parked request is now live only while the agent that asked is running. The
asking tool's abort signal already settled a stopped turn, but a request that
arrived without one — or one whose turn ended by a path that never aborted it —
stayed parked for the life of the process: the operator kept a form that could
no longer be answered, and the answer they sent resolved a promise nobody was
waiting on. The gate also settles what it parked when that agent goes idle, so
the wait and the form end together.

The page, in turn, keeps reading the Host's list while a form is visible and
reads it once per chat binding and per reconnect. A question parked before a
reload comes back instead of leaving an empty composer in front of a waiting
agent, a request the turn can no longer answer leaves the screen within a poll
instead of sitting there answerable but dead, and an answer for a request the
Host no longer holds is refused rather than silently resolved.

Two configurations that quietly do nothing were also made visible: questions
interactive while `lockdown.toolPolicy.allow` does not name `ask_user_question`
(no form can ever appear), and the tool allowed while questions are refused
(every ask is turned away). Both now log one `question.config-incomplete`
warning per attested session, naming which half is missing, and the settings
card's status view shows the seam's mode and raises the same warning in the
page, so an operator sees it without reading a log. The lifecycle of the seam is
reported as `question.claimed`, `question.answered`, `question.cancelled`,
`question.aborted`, `question.delegated` and `question.refused` — with the shape
of an answer, never its text.
