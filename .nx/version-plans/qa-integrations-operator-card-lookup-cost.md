---
"@yadsh/dsh-qa-integrations": patch
---

The operator card's settings tests now cost what they assert, not what the runner can spare.

Six of them reached a control by searching the whole rendered card, and this card is a thousand nodes — seven providers, two hundred labelled controls. Those six were the only tests in the package that cost a second or more, so this one file outweighed the other one hundred and eleven put together: green on a developer machine, a timeout on the shared runner, and the pull requests that inherited the red were mostly branches that never touched this package. The file's previous answer had been a widened per-test budget, which moved the ceiling further away without removing the cost.

Scoping a lookup to the provider section that owns the knob did not remove it either, because the price is not in the tree the query is given but in how a label gets resolved: the testing library asks every form control for its labels, and jsdom answers that by scanning all two hundred `<label>` elements of the card once per control. The first lookup into a section then costs 40–150 ms whatever subtree it was scoped to, and a role query by name is worse still — it computes the accessible name of every button on the page before it answers. The card's tests now read the binding from the label's side, which is what a click on a caption uses, and find a button by its caption. The `get` contract is kept: a caption that binds nothing, or binds two controls, fails the test.

The heaviest case went from 1.7 s to 0.03 s. What is left per test is one render of the card — the thing under test — rather than a lookup priced by the controls of this card times its labels, so a busier or slower runner changes the duration of this file and not its verdict. The Weblate catalog test rebuilt all one hundred and thirty-two tool schemas about ten times inside a single test; the surface is static, so it is built once.
