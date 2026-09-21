# Checkpoint template

Copy the block below into `.private/<topic>.md`. Keep it under 40 lines: the
test of a checkpoint is that a reader who has never seen the task can name the
first command to run after one pass.

## Template

```markdown
# <topic> — checkpoint

Updated: <YYYY-MM-DD HH:MM> by <agent/model name>
Objective: <one sentence, in the maintainer's words>
Branch: <branch> @ <short sha>   Worktree: <absolute path>
Committed: <sha> — <subject>
Uncommitted: <path> — <whose it is>

## Verified
- <command> — <result, with numbers>
- NOT verified: <claim that is still an assumption, and why it could not be checked>

## Decisions
- <what was settled> — <why>   (do not re-open without new evidence)

## Open
- <symptom> — <where it shows up> — <what was ruled out>

## Next
1. <exact first command or file>
2. <then what>

## Do not redo
- <search/probe already done, and its conclusion>

## Expiry
Delete when: <PR merged | feature on the stand | plan closed>
```

## Filled example (synthetic)

```markdown
# PROJ-123 provider support — checkpoint

Updated: 2026-01-14 18:20
Objective: add a read-only provider for the tracker the maintainer named
Branch: feat/PROJ-123-provider @ 4c1f9a2   Worktree: /repos/<repo>/worktrees/proj-123
Committed: 4c1f9a2 — feat(integrations): add the provider skeleton
Uncommitted: docs/README.md — maintainer's wording pass, do not commit yet

## Verified
- pnpm --filter <pkg> run check — green, 214 tests
- provider smoke against jira.example.corp — 200 on /issue, 401 on /search
- NOT verified: pagination beyond 50 items (no fixture); live stand not touched

## Decisions
- reuse the shared HTTP client instead of the SDK — SDK pulls a Node-only dependency
- tool names follow the newest provider, not the older ones (naming drifted once)

## Open
- HTML in the description field renders as markup — parser drops tags upstream
- refused "for a client session" on the stand — allow-list of the overlay, not the code

## Next
1. add the pagination fixture under the package's tests, then re-run check
2. wire the settings card field, then rebuild the client bundle

## Do not redo
- grep of the three earlier providers — they disagree on error shapes; the newest one wins
- local stand check — unreachable from this machine, ask the maintainer

## Expiry
Delete when: PR is merged into the release branch
```

## What each section buys

| Section | It prevents |
| --- | --- |
| Objective | a resumer optimizing for the wrong outcome |
| State (branch, sha, ownership of uncommitted files) | committing someone else's WIP, working in the wrong checkout |
| Verified / NOT verified | an assumption being reported later as a checked fact |
| Decisions | the same design argument happening twice |
| Open | a known failure being rediscovered as a surprise |
| Next | a rediscovery pass before the first useful command |
| Do not redo | re-running searches that already paid for themselves |
| Expiry | a stale checkpoint contradicting `HEAD` weeks later |

## Update checklist

Run through this whenever you touch the checkpoint:

- [ ] the recorded branch and sha still match `git rev-parse --short HEAD`;
- [ ] anything you verified since the last update moved from an assumption into
      `Verified`, with its number;
- [ ] `Next` names an action that is still valid — if it was done, replace it,
      do not append;
- [ ] files you now own are listed in `Uncommitted` with their owner;
- [ ] anything durable learned along the way was promoted into the memory tier
      (one file plus one index line), not left only in the checkpoint.
