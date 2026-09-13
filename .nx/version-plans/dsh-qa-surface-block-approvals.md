---
"@yadsh/dsh-qa-surface": minor
---

Enforce `interaction.approvals: blocked` on every attested QA agent. An outer
pre-execute listener converts any composed tool-policy `ask` into an explicit
QA denial before the approval service can route or record a question, so a
headless `approval=never` decision is not misreported as a user rejection. The
per-user path guard now supports absolute `sharedReadOnlyRoots` for reviewed
filesystem read tools while keeping every write inside the account directory.
It no longer rejects read-only `dsh_git_*` tools by name; repository selection
remains the responsibility of the separately configured Git plugin.
