---
"@yadsh/dsh-qa-integrations": patch
---

The operator card's settings tests now cost what they assert, not what the runner can spare.

Six of them reached a control by searching the whole rendered card. A label lookup is priced by the tree it walks, and this card is a thousand nodes — seven providers, two hundred labelled controls — so each of those six paid about two seconds. They were the only six tests in the package that cost a second or more, and together this one file outweighed the other one hundred and eleven put together. Green on a developer machine, a timeout on the shared runner — and the pull requests that inherited the red were mostly branches that never touched this package. The file's previous answer had been a widened per-test budget, which moved the ceiling further away without removing the cost.

Every knob is now looked up through the provider section that owns it, which is the claim these tests were making anyway: a capability is read inside that provider's own checklist, a folded numeric knob inside the group that folds it. The file runs in under two seconds and fits the repository's default five-second budget again, so a slower or busier runner no longer changes the verdict. The Weblate catalog test rebuilt all one hundred and thirty-two tool schemas about ten times inside a single test; the surface is static, so it is built once.
