---
"@yadsh/dsh-documents": patch
---

The documents settings card is now addressable by a stable hook.

Every section of the card the operator edits — the pipeline, extraction, the
parsers, artifacts and the template/limit budgets — carries a `data-testid`, and
so does each control inside it and each section's reset button. The ids are ASCII
kebab-case under the `docs-` zone (`docs-pipeline`, `docs-extraction-ocr`,
`docs-artifacts-retain-source`, …), so a browser test reaches a knob without
reading the Russian caption or the BEM class that used to identify it, and no two
ids in the package collide.

Only an attribute was added: the markup, the shell contract and the rendered text
are unchanged. The comparison section is left untouched (its configuration is led
by #422), and the tools inventory keeps being asserted by the text it shows — the
tool names are the thing under test there, not a label to hang a hook on.
