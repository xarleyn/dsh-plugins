---
"@yadsh/dsh-qa-surface": patch
---

Publish the signed-in QA account as a client service. A QA panel plugin receives
the account token through its panel props, which is why the integrations page
could live in the settings dialog and nowhere else: a card mounted in the host's
own settings has no panel to read it from. `qaUserSession` closes that gap — it
reports `checking`, `anonymous` or `authed` with the bearer credential the
principal-scoped QA remotes authorize with, and follows the same account
controller the pages use, so every mount sees one session. The credential is
transport authentication only: consumers must not persist it, log it, or place it
in a URL or a model-visible value.
