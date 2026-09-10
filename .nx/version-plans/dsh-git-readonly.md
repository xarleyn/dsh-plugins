---
"@yadsh/dsh-git-readonly": minor
---

Initial release: four read-only git provenance tools (`dsh_git_context`,
`dsh_git_history`, `dsh_git_show`, `dsh_git_blame`) that let an agent answer
"what task was this changed for" against the session repository without ever
receiving a command line. The model passes structured parameters only —
hexadecimal commit ids, repository-relative paths after `--`, bounded literal
search strings; the plugin builds and spawns the git argv itself, hardened
against repo-controlled config (`diff.external`, textconv, `core.fsmonitor`
are disabled and proven never to execute) and against a poisoned ambient
environment (git redirection and config keys stripped, deterministic values
forced). Fail-closed session/repository resolution, byte-capped and
time-boxed subprocesses with explicit truncation flags, structured bounded
output, typed error codes, and a mutation test suite asserting the
repository stays byte-identical across every tool call.
