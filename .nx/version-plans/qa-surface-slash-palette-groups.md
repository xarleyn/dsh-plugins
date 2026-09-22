---
"@yadsh/dsh-qa-surface": patch
---

The slash palette captions each group once instead of once per run of rows.

Ranking is global across the two halves of the catalog, so one query can put a
command between two skills — and the palette, which draws a titled group per
kind, drew «Навыки» again after the command. One group read as two, and the
second header said nothing about the rows under it.

The grouped order is now the order the palette draws, and it is the order the
keyboard walks: the rows of a kind stand together, the group holding the
best-ranked row leads, and each group keeps the ranking's order inside it. The
first row of the list — the one Enter picks — is therefore still the best match,
which is why the group order follows the ranking rather than a fixed
skills-then-commands rule.

`palette-rows.ts` holds that translation as a pure function, so the hook, the
component and the tests share one definition of what a group is.
