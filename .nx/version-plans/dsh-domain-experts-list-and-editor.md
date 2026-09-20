---
"@yadsh/dsh-domain-experts": patch
---

Editing a domain is discoverable, and leaving the editor no longer drops unsaved edits.

The tab rendered its list and its editor as two wrapping flex columns. The
settings dialog is narrower than their combined minimum, so the editor wrapped
*under* a list of eight cards: clicking a domain appeared to do nothing, and the
only control a card offered was `Disable`, which reads as "this record cannot be
changed".

The list and the editor now share one pane, so opening a domain replaces the
list, and an explicit `Edit` button sits next to `Enable`/`Disable` on every card
instead of the card body being the only, unlabelled way in. `All domains` above
the form returns to the list, and it asks before discarding when the draft
differs from the definition it was loaded from — including when the header starts
another domain while an edited one is open.

A domain that disappeared while the list was open reports that on the list now,
instead of a message that had nowhere left to render.
