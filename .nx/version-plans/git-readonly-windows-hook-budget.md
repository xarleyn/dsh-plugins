---
"@yadsh/dsh-git-readonly": patch
---

The plugin's own git suites finish on a loaded Windows run instead of timing out
before their first assertion, and they no longer inherit the identity of
whoever runs them.

Every git suite builds a throwaway repository in `beforeAll` — the mutation
suite builds two and clones one — so a test file spends a dozen `git` process
spawns before it asserts anything. Vitest gives a hook ten seconds, and this
package re-exported the shared preset with no override, so a full
`nx run-many -t test` on Windows lost test files to `Hook timed out in 10000ms`.
Vitest then marks such a file's tests skipped while counting the file itself as
failed, which is what the 22.09 full-run slice reported. Process creation, not
git work, is what ten seconds cannot cover there. The per-project CI matrix
never sees it: one project alone on one Linux runner does not carry the load
that makes spawning git expensive. The package now budgets 90s per hook and 30s
per test, the same allowance the browser plugin gives its I/O-bound suites.

The throwaway repositories were also not hermetic. `GIT_AUTHOR_*` and
`GIT_COMMITTER_*` outrank both the `user.name` the fixture writes into the
repository and the per-commit `-c user.name=` override, so a caller that
exports its own identity — a CI bot, an agent harness — silently became the
author of every fixture commit, and the blame, context and history assertions
failed on that name. The fixture now strips those six keys from the environment
of every `git` it starts, so the identity it pins in repository config is the
identity commits carry.

No runtime behavior changed: both fixes live in test configuration and test
fixtures.
