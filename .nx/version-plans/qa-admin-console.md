---
"@yadsh/dsh-qa-surface": minor
---

Add the administrative console behind `/qa/admin`: an authorization model with
the `reviewer` role and named permissions, user management (role, status and
QA subrole assignment), a filterable list of every conversation with a review
viewer that reads the stored transcript and the frozen capability snapshot,
per-message 👍/👎 feedback with an optional reason and comment, a derived review
queue with the reviewer taxonomy and severity, quality aggregations by subrole
and over time, and one audit timeline covering both writers.
