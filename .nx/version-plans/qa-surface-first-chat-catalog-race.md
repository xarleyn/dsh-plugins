---
"@yadsh/dsh-qa-surface": patch
---

The first chat after a sign-in stops failing with «Не удалось начать чат.» over a
session the stand had in fact created.

The browser holds its own catalog of sessions, and `sessions.retain` answers from
that catalog: an identity it has not listed yet is refused with `sessions.retain:
unknown session`. A QA session is born on the server, through this plugin's own
Remote, so the create can answer before the row that lists it reaches the browser —
and the surface asked for the reference in exactly that window. The refusal was
reported as a chat that could not start, while the chat was already there in the
sidebar, one row the visitor had not opened and could not.

The adoption now waits for the catalog to name the id before it retains it, and asks
for a fresh baseline rather than only for whichever of the push or the pull happens
to come first; the wait is bounded by the same timeout every other DSH wait uses, and
when the row really never arrives the operator reads the Host's own refusal, not a
timeout nobody asked for. Because the failure is intermittent, the two moments of the
race are logged when it happens — the refused retain with its timestamp, and the row
that came for it with the time spent waiting — so a round that loses the chat can
tell which side of the create it lost it on. A first send that materializes its
session lazily rides the same repaired path.
