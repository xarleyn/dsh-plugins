---
"@yadsh/dsh-git-readonly": patch
---

The plugin's own git suites finish on a loaded Windows run instead of timing out
before their first assertion, and they no longer inherit the identity of
whoever runs them.

Every git suite builds a throwaway repository in `beforeAll` — the mutation
suite builds two, and a single repository costs seven `git` calls before it
holds one commit — and the snapshot tests then walk the repository they built.
Vitest gives a hook ten seconds and a test five, and this package re-exported
the shared preset with no override, so a full `nx run-many -t test` on Windows
lost suites to `Hook timed out in 10000ms`. Vitest marks the tests of such a
file skipped while counting the file itself as failed, which is how the 22.09
full-run slice read as six failures.

It is the load that the budgets could not cover, not the git work: process
creation and file I/O get expensive enough that the heaviest snapshot test costs
a second on an idle machine and measured 52s inside a full run, and the two
heaviest files reached 139s and 103s. The package now budgets 120s per test and
90s per hook, and runs its suites on two Vitest workers rather than one per
logical CPU. Every worker builds its repositories with real `git` children, so
the suite was inflating the load it then failed to meet, and a `git` child that
comes back non-zero without a word is not a thing any budget forgives.

The ceiling therefore sits on the child rather than on the budget: each fixture
`git` run is killed at twenty seconds and reports which command it was. A hang
then costs one named command instead of a whole test budget, which is what makes
the two numbers above headroom over a measured slow run rather than a place for
a hang to idle. A loaded run is not a Windows-only case either — the per-project
split the pipeline fans out with has collapsed into a single job running every
project on one runner, and five other suites timed out inside it while this one
finished.

The throwaway repositories were also not hermetic. `GIT_AUTHOR_*` and
`GIT_COMMITTER_*` outrank both the `user.name` the fixture writes into the
repository and the per-commit `-c user.name=` override, so a caller that
exports its own identity — a CI bot, an agent harness — silently became the
author of every fixture commit, and the blame, context and history assertions
failed on that name. The fixture now strips those six keys from the environment
of every `git` it starts, so the identity it pins in repository config is the
identity commits carry.

A third failure the same runs exposed was not a timeout at all: one of the
fixture's setup `git` calls came back failed with nothing on stderr, which
dropped its whole test file and left those tests reported skipped. git writes a
diagnosis whenever it chooses to refuse, so silence means the child died before
refusing anything. The fixture now reports the exit code and signal it used to
discard, and retries a setup command only on that silence — up to three more
attempts with a short backoff. Commands past setup keep failing on their first
error, because a retried commit would leave two commits where the snapshot
compares against one.

No runtime behavior changed: these fixes live in test configuration and test
fixtures.
