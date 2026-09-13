---
"@yadsh/dsh-cas-results": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-kv-persist": patch
"@yadsh/dsh-l10n-overrides": patch
"@yadsh/dsh-prompt-firewall": patch
"@yadsh/dsh-session-scope": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-tool-offload": patch
"@yadsh/dsh-ui-repair": patch
"@yadsh/dsh-user-correction-miner": patch
---

Make the published packages discoverable to the DSH ecosystem. npm only serves
what a published tarball carries, so every package now ships the canonical
keyword set (`deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`) plus
its own feature words, alongside the repository, homepage, and bug-tracker
metadata that ties the package back to its directory in this monorepo. DSH
directories and marketplace indexes discover plugins through those keywords and
through the `dsh-plugin` GitHub topic, and an indexer that cannot attribute a
package to its sources reports it as published without a public repository.
Packages that ship no keywords at all were invisible to those indexes. The
repository root also gains a generated `plugins.json` catalog that maps every
npm name to its directory, install command, and homepage, and the package
hygiene gate now rejects a manifest whose metadata is missing or stale.

The published tarball also stops carrying repository documentation — specs,
changelogs, roadmaps, design docs, integration notes, and README translations
stay in the repository, so an install pulls the runtime and the bundle patch
instead of prose. Relative links in a published README now point at GitHub
where the tarball no longer holds the target.
