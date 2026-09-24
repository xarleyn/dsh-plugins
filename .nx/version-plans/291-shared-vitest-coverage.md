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
and writes the same machine-readable summary. Four of them had a
`coverage.include` of their own; the preset merges arrays instead of replacing
them, so a narrowed one never applied and a repeated one only duplicated the
base. `dsh-documents` raises its test timeout to 30s because its suites spawn
real converters and that is the budget an instrumented run needs. No runtime
change.
