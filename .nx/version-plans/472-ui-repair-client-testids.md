---
"@yadsh/dsh-ui-repair": patch
---

The repair settings card carries stable `data-testid` selectors.

Every control the card renders — the four policy switches, the mode and
confidence fields, the scan and rollback actions, the per-issue Apply and Ignore
buttons and the ignored-selector form — is now addressable by a test id, so a
browser test of the card survives a rephrasing of its labels. The card keeps the
`data-dsh-ui-repair-*` attributes it already used to keep itself out of its own
scan; the ids sit beside them and nothing was renamed.
