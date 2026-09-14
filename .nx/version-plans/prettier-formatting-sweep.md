---
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-doc-impact": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-git-readonly": patch
"@yadsh/dsh-kv-persist": patch
"@yadsh/dsh-l10n-overrides": patch
"@yadsh/dsh-plugin-log": patch
"@yadsh/dsh-plugin-log-ui": patch
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-session-scope": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-tool-offload": patch
"@yadsh/dsh-ui-repair": patch
"@yadsh/dsh-user-correction-miner": patch
"@yadsh/dsh-web-fetch-authenticated": patch
---

Reformat the package with the repository's shared Prettier configuration. The
config now lives in the repository root instead of inside four packages, and
this sweep brings every package to it. Formatting only — no behavior and no API
change beyond the reformatted sources in the published tarball.
