---
"@yadsh/dsh-openviking-memory": patch
---

Both OpenViking Memory settings surfaces carry stable `data-testid` selectors.

The configuration card names its seven sections (`openviking-card-recall`,
`openviking-card-capture`, …) and every control inside them by the section that
owns it and the settings key it writes
(`openviking-card-recall-token-budget`), so a browser test reaches a field
without reading the hint under its label. The override marker derives its id
from the control it marks
(`openviking-card-connection-endpoint-override`), the badge and
the loading and write-error lines are named for the state they project, and the
reset action is one hook rather than a hunt for a button whose caption counts
overrides. The account-scoped memory page is `openviking-memory-*`: the page,
its totals and the three notices that qualify them, the profile, group and
session rows, the line that says which space is being shown, and the refresh
control. A repeated node holds the id of its template, so no index is baked
into a name.

The two client suites now ask for those ids where they used to search the card
for a sentence or a BEM class, and each keeps the assertion it was really
making: the section heading is still checked as the heading it announces, the
reset and refresh controls as buttons named by their caption, and every field's
label as the accessible name that still points at the node the id found. The
card shell itself is the shared `AGENTS.md` contract and was left alone, so its
class queries stay where they are.

Nothing moved and no existing class changed: the ids are an addition to the same
elements, and the markup of the three files is identical to the previous one
once the added attributes are removed.
