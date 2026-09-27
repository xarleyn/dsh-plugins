---
"@yadsh/dsh-session-audit": patch
---

The session audit view carries stable `data-testid` selectors.

The page, its tab panel and the notice about audits that are attached to no
session can now be addressed by a test id instead of by the wording of a
sentence or by a CSS class, so a browser test of the audit view survives a
change of copy. The notice's rows and their reason lines are labelled as
templates, so a test names the row it reads instead of searching the page for
the sentence inside it. The view's own suite moved to those ids and still
asserts the wording and the list semantics it checked before. Nothing moved and
no existing class changed: the ids are an addition to the same elements.

The page's id names the container, not the branch that rendered: a session with
an audit and a session without one both answer to `audit-page`, and the notice
inside the second is `audit-page-empty` — the shape the log panel already uses,
where `log-panel` stays put and its own note is `log-panel-empty`. So a test
reaches the page the same way whichever state it is in. Loading and error still
render the shared audit components, whose markup this package does not own, so
they carry no id from here.
