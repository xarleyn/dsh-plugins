---
"@yadsh/dsh-qa-surface": patch
---

The shell's own screens are now addressed by a stable id.

The surface root, its zones, the account-checking placeholder, the
administrator-only refusal, the empty-chat welcome, the read-only and error
notices, the composer's slot and the guard's failure card carry `data-testid`
(epic #453). Tests that located those nodes by CSS class or by visible wording
now ask for the id, so rephrasing the stand no longer reads as a broken build;
the role and accessible-name assertions that check the same nodes stay. The
fullscreen frame the failure card inherits from the surface root is pinned as a
stylesheet contract, which is the only claim a class query was really making.
