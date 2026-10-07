---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-git-readonly": patch
"@yadsh/dsh-jev-compaction": patch
"@yadsh/dsh-kv-persist": patch
"@yadsh/dsh-l10n-overrides": patch
"@yadsh/dsh-lightrag": patch
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-openviking-memory": patch
"@yadsh/dsh-plugin-log-ui": patch
"@yadsh/dsh-preset-persona-editor": patch
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-qa-browser": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-qa-surface": patch
"@yadsh/dsh-session-audit": patch
"@yadsh/dsh-session-scope": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-tool-offload": patch
"@yadsh/dsh-ui-repair": patch
"@yadsh/dsh-user-correction-miner": patch
"@yadsh/dsh-web-fetch-authenticated": patch
---

Every plugin row on the Host's Plugins page is named in words.

The page titles a bundle's row and fills its description line from the package's
exported `locale/en.json`, which the Host resolves through the package's `exports`
map without activating the plugin (`@deepseek-ai/dsh-app-boot` `package-meta.ts`).
Only `dsh-documents` shipped that file, so the other twenty-five rows were signed by
their full package specifier — an operator read `@yadsh/dsh-jev-compaction` where a
first-party row read a phrase. Each package now exports `./locale/en.json`, publishes
`locale/*.json`, and carries English `meta.title` and `meta.description`; where the
package already had a configuration card, its `summary` one-liner and the row's
description are one string, pinned by a test against the shipped file rather than
against a copy in the test. `pnpm verify:packages` asks all three halves of every
plugin package, so a row cannot fall back to a specifier unnoticed.

Two pages still seated on the deleted-in-spirit `settings.plugins.tab` move to the
panel with them. `dsh-prompt-firewall` edits its own Config namespace, so it takes the
row seat keyed `@yadsh/dsh-prompt-firewall#dsh-prompt-firewall` — the row id is the
namespace the Host serves the form under, so no saved value is orphaned — and with the
seat it gives up its shell, its header badge and its show/hide labels, taking the
Host's `--dsw-focus-ring-*` pair for every control it draws and answering the
unavailable namespace with a sentence instead of an empty section.
`dsh-domain-experts` owns no form — it edits domains through its Remote services — so
it takes the bundle-level seat `plugins.bundle.config`, keyed by the package name, and
drops the `<h2>` heading and the intro line the panel already draws from the row's own
display metadata.
