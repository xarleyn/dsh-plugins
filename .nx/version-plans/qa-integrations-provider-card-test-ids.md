---
"@yadsh/dsh-qa-integrations": patch
---

The plugin's own provider cards are addressable by a stable hook.

Every block a card renders from `src/client` now carries a `data-testid`: one
zone per card (`qa-integrations-provider-card-jira`,
`qa-integrations-provider-card-gitlab`, …) named from the provider key the card
already declares, and inside it the blocks by what they hold — `-error`,
`-summary`, `-credential`, `-instance-picker`, `-deployment`, `-capabilities`,
`-capability-issues-read`, `-service-option`, `-boundary-summary`,
`-disconnect-confirm`. The two mounts of the same cards are named too: the QA
settings page (`qa-integrations-page`) and the host's plugin tab
(`qa-integrations-host-tab`). The `provider-card-` segment keeps these hooks
apart from the operator card's sections, which own `qa-integrations-<provider>`,
so the two surfaces never answer to the same id.

The card tests that used to reach one of these blocks through its Russian
caption or its BEM class now reach it through the id, so rewording a heading or
restyling a block no longer blinds a test that was asserting something else.
What a test asserts about a caption or a control — that the site picker is
labelled, that the connect button is named "Сохранить и проверить", that the
disconnect confirmation is an `alertdialog` carrying the provider in its name —
is still asserted by role and accessible name, and one test now checks that a
mount of two cards repeats no id and that every id is ASCII kebab-case. No
markup and no style changed: an attribute was added.
