---
"@yadsh/dsh-qa-surface": patch
---

Read the administrator's capability catalog in the QA preset's scope.

`«Общие возможности»` listed almost nothing: the catalog was read globally, while everything a deployment actually mounts — the kit's skill catalog (`search-jira`, `search-docs`, `search-corporate-work`), the preset's tool family (filesystem, web, delegation) — registers in the agent preset's scope. Every skill the operator opens the console to grant was invisible, and the skill-grant ceilings resolved against a tool set that did not contain the preset's tools either.

The catalog now borrows the standing scope of the preset QA chats run under (`session.agentPreset`; `qa-research` on the stand) — the same key the harness hands a reader as a registry view scope. Resolving it composes the preset but starts no agent, no session and no turn; without a pinned preset, or when the composition cannot be read, the read degrades to the previous global view and the page still opens.
