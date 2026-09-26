---
"@yadsh/dsh-prompt-firewall": patch
---

The Prompt Firewall settings card is now addressable by a stable hook.

Every section of the card — Policy, Last request, Rules, the Audit & metrics
drawer and the Prompt Inspector — carries a `data-testid`, as do its toggles,
selects and inputs, its empty/error states and the per-row actions of the rules
list and the inspector table. The ids are ASCII kebab-case under the `pf-` zone
(`pf-policy-mode`, `pf-audit-preview-chars`, `pf-rules-add`, …); a repeated node
is numbered by its place in the list (`pf-inspector-row-0-block`,
`pf-rules-row-1-remove`) rather than by the section name it holds, so a browser
test reaches a control without reading its English caption or a BEM class, and no
two ids in the package collide.

Only an attribute was added: the markup, the card shell and the rendered text are
unchanged, and the existing logic tests do not touch these nodes, so none needed
rewriting.
