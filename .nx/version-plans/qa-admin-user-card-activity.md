---
"@yadsh/dsh-qa-surface": patch
---

The administrative user card opens fast again, and saving an edit confirms
itself on the spot.

The card used to fill its «Сообщения» activity counter by reading every
conversation the account owns, and reading one conversation on the Harness
costs a full persistence listing of the deployment's sessions before it
reaches the one log it asks for. On a real store that made the card wait
minutes — and because a write returned the recomputed detail, every save (a
role, a status, a profile assignment) paid for the same scan again, which
looked like an edit that silently refused to apply.

The card now answers from the account stores and the feedback store alone;
the messages counter reports "unknown" and is counted where the transcripts
are read anyway — the conversations page, whose rows already carry a
per-conversation message count. A save applies the update response directly
instead of re-requesting the user, so the checkbox reflects the change as
soon as the server accepts it.
