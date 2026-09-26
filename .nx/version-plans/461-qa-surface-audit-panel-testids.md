---
"@yadsh/dsh-qa-surface": patch
---

The audit badge, the audit dialog and the extension panel became addressable from
a browser run.

Epic #453 gives the surface handles that survive a copy edit and a language
switch. The transcript got its own in the same epic; this is the two zones that
sit beside it — the mark a session row carries when its chat has been audited,
the dialog that opens from it, and the right-hand panel an extension mounts into.

The four components now carry `data-testid`: `qa-audit-badge` with its check and
its verdict, `qa-audit-dialog` and `qa-audit-dialog-body` for the dialog, and
`qa-panel` for the panel shell with `qa-panel-header`, `qa-panel-title`,
`qa-panel-close`, `qa-panel-resizer`, `qa-panel-body`, the `qa-panel-launcher`
strip and its `qa-panel-launcher-button`, plus `qa-panel-missing` and
`qa-panel-error` for the two diagnostics the shell renders when a panel has no
keyed body or its body throws. Values are ASCII kebab-case and each zone keeps its
own prefix. A repeated node carries the value of its template rather than a key
substituted into it — every launcher button and every retained panel body reads
alike, and which one a run means stays the run's business, told apart by the
accessible name or the place in the list the node already offered. Text
paragraphs and the layout wrappers between the parts stay unnamed, so an id marks
a control, a state or a shell rather than a sentence.

Nothing here is user-visible: only attributes were added, every element, class,
role and aria attribute stayed as it was, and the sheet still describes every box.
The package's own checks moved to the new handles wherever they had used a BEM
class as the locator — the verdict of a badge, the modifier a row with a delete
control gets, the resizer and the retained body of a panel — while each assertion
on a role or an accessible name stayed where it was.
