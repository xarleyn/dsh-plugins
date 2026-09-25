---
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-qa-browser": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-session-audit": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-ui-repair": patch
---

Test coverage now comes from the shared Vitest preset, so `pnpm run
test:coverage` measures the same tree in every package and writes the same
machine-readable `coverage/coverage-summary.json` beside the printed table.

Until this release the preset carried no coverage block at all, so whatever a
package listed as its `include` was the whole denominator. That choice is gone:
`mergeConfig` concatenates arrays instead of replacing them, so a re-declared
`include` can only widen the tree and `exclude` is the only way left to measure
less. The blocks are dropped rather than rewritten, which means a package that
used to measure part of its sources now measures all of them, client code
included. Where that happens the percentage falls with the wider denominator
while not a single test changed, and the number is comparable with the other
packages of this workspace but not with what the same package printed before.
Neither is it comparable with the older test-lines-per-source-lines ratio, which
counted words instead of executed statements.

No thresholds on purpose: the percentage is a measurement to read before a
refactor, not a gate that competes with the per-file size budget. No runtime
change.
