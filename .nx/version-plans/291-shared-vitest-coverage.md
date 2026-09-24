---
"@yadsh/dsh-documents": patch
"@yadsh/dsh-draft-sessions": patch
"@yadsh/dsh-qa-browser": patch
"@yadsh/dsh-qa-integrations": patch
"@yadsh/dsh-session-audit": patch
"@yadsh/dsh-sleev": patch
"@yadsh/dsh-ui-repair": patch
---

Every one of these plugins now takes its test coverage from the shared Vitest
preset, so `pnpm run test:coverage` measures the same `src` tree in each of them
and writes the same machine-readable summary. Two of them carried a narrowed
`coverage.include` that the preset merges instead of replaces, so it never
applied; `dsh-documents` raises its test timeout to 30s because its suites
spawn real converters and that budget is what the instrumented run needs. No
runtime change.
