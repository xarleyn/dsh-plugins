---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-documents": patch
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

Every plugin declares the `0.1.7-rc.2` host — the metadata wave of the cutover.

`compatibility.json` carries `>=0.1.7-rc.2 <0.2.0` and `0.1.7-rc.2` as its tested
release, and the Requirements/Compatibility lines of the README and SPEC that
restate that pair moved with it, so a package page and its manifest agree. The
checks that hard-code the pair moved in the same change: two `deepEqual`
assertions in the package verifiers, one bundle test, the plugin generator's
scaffold defaults with its test, and the fixtures of the repository gates that
read them.

Dated records keep the version they were written against. Phase 0 and spike
findings documents, `SPEC` baseline tags and permalinks into the harness tree,
and a released QA changelog entry still name `0.1.5-rc.2`, because each reports
what was observed on that host rather than what the package supports now.
