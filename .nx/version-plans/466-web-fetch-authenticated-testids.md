---
"@yadsh/dsh-web-fetch-authenticated": patch
---

The settings card is addressable by a stable id.

Every section of `src/client`, the controls inside them and the states they
report now carry `data-testid` (epic #453): 84 ASCII kebab-case values, one zone
per section in the prefix — `wfa-card`, `wfa-status`, `wfa-global`, `wfa-rules`
with the rule row and its editor, advanced block, credential control and tester
under the same `wfa-rule` zone, and `wfa-diagnostics`. A browser run reaches the
provider pill, a config error or warning block, a rule row and its four actions,
the write-only credential pair and its save/remove, an editor field, a tester or
diagnostics report without naming any of them by the English copy they render or
by the `wfa-*` class they share with their siblings. A shared control (`Pill`,
`ToggleRow`, `IconButton`) takes its id from the call site that places it, so the
enabled pill of a row and the state pill of the credential block never answer to
one selector; a repeated node keeps the id of its template and no index is baked
into a name, while the six network checkboxes name the policy field they write.
The summary that expands the collapsed advanced block is named too, so the fields
behind it are reachable without clicking a phrase, and the block still opens
closed — nothing here moved but attributes. Layout wrappers, `MetaLine` facts and
the explanatory notes stay unnamed: an id marks a control, a state or a shell.

Nothing moved but attributes — every `className`, `role`, `aria-*`, placeholder
and text node of the card is what it was, and the settings-card shell contract of
`AGENTS.md` is untouched. No test located these nodes by class or copy, so none
had to be rewritten; the card has no DOM-rendering test, so the contract is
pinned against the source instead — `tests/client-testids.test.ts` reads the
client tree and holds the ids to their shape, their zone, their uniqueness and
their coverage, so an unnamed control fails a gate rather than a browser run.
