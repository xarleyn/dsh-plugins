---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-decision-tools": patch
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-documents": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-git-readonly": patch
"@yadsh/dsh-jev-compaction": patch
"@yadsh/dsh-kv-persist": patch
"@yadsh/dsh-l10n-overrides": patch
"@yadsh/dsh-lightrag": patch
"@yadsh/dsh-llm-provider-extended": patch
"@yadsh/dsh-model-safety-gate": patch
"@yadsh/dsh-openviking-memory": patch
"@yadsh/dsh-plugin-log-ui": patch
"@yadsh/dsh-preset-persona-editor": patch
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-qa-browser": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-session-audit": patch
"@yadsh/dsh-session-scope": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-tool-offload": patch
"@yadsh/dsh-ui-repair": patch
"@yadsh/dsh-user-correction-miner": patch
"@yadsh/dsh-web-fetch-authenticated": patch
---

Build the workspace against DeepSeek Harness 0.2.0-rc.2 and widen the published Host support to the whole 0.1.7-to-0.3.0 line.

The dependency graph is made homogeneous rather than re-typed: the workspace root declares the 26 Host packages that peer resolution pulls in on its own as development roots through `catalog:dsh-dev`, that catalog gains the ten keys the set was missing, and every development pin moves to `0.2.0-rc.2`. Without those roots the same install keeps 26 packages at 0.1.7-rc.2 and reports conflicting peers, because a catalog entry only reaches a package some dependency edge actually names.

Each package now declares `>=0.1.7-rc.2 <0.3.0-0` as its supported Host range. The ceiling is written as `-0` so that the host's `includePrerelease` comparison cannot let a release candidate of the next minor line inside it. `compatibility.json` keeps `testedReleases` at `0.1.7-rc.2`: the range says what is supported, the list says what was verified, and acceptance against a real 0.2.0-rc.2 host has not run yet.

The lockfile is deduplicated as part of the same change, which the workspace dependency rules require.
