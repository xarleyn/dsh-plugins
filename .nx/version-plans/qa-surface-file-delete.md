---
"@yadsh/dsh-qa-surface": minor
---

The QA tool catalog gains its first destructive capability: `file_delete`,
deleting one workspace file with a mandatory operator confirmation.

The catalog (version 2) ships `file_delete` next to `qa_tools_selfcheck`.
It removes a single regular file strictly inside the calling chat's own
workspace root — relative or absolute-inside paths both work — and refuses
everything else with an explicit reason: paths outside the workspace,
symlink escapes (the deepest existing ancestor is resolved with realpath and
verified for containment), directories and missing files. A missing or
blank session cwd is a typed refusal, never a fallback to the process
working directory, and refusals never echo absolute host paths.

Every call is gated: a `tools/pre-execute` listener answers `ask` for
`file_delete` from an attested session, so the interactive approval card
parks the request over the composer and nothing is deleted until the
operator allows it once. Other tool names pass through untouched, and the
existing allow-list, workspace fence and sandbox still apply to the
resolved call. No allow-list entry is needed: the dynamic catalog
admission already admits names the activation manager registered.

The chat client also drops the machine-scent: the question form's status
strip and pager are separate elements without the middle-dot separator,
question headers no longer uppercase with letter-spacing, punctuation-only
option descriptions and details («?», «...») produced by small models are
no longer rendered, the approval card marks a delegated request with its
own span instead of a dot-glued suffix, and the subagent drawer renders
settlement meta as separate parts instead of a dot-joined string.
