---
name: session-checkpoint
description: Leave a resumable checkpoint on disk so the next reader — the same
  session after a compaction, a fresh chat, or a subagent — continues the work
  instead of re-discovering it. Use before a long run (release wave, refactor
  sweep, subagent fan-out, long test matrix), after every milestone, when the
  context is filling up, and before ending a turn on unfinished work. Also use
  when the instruction is a bare "продолжай"/"продолжи"/"continue", "память
  кончилась", "контекст сжался", or when picking up work someone described as
  "уже начато" without a written state.
---

# Leave a resumable checkpoint

A long task outlives one turn, and this runtime loses the details that matter
operationally when that happens. Two mechanisms exist and neither is enough:

- **Auto-compaction.** When the context runs out, the runtime injects its own
  summary of the earlier conversation. It preserves intent and concepts and
  drops what a resumer actually needs: exact SHAs, file paths, command lines,
  and which claims were verified versus assumed.
- **Forking.** A session can be forked from a message, and a fork restores
  **no** workspace checkpoint on its own.

So the gap is not "the next agent does not know what I was doing" — it knows
roughly that. The gap is "the next agent cannot act without re-reading the
repository". The remedy is a small file on disk, written while you still have
the facts, that turns resumption into one read.

**The trigger to watch for:** the maintainer nudges with a single word
(`Продолжай`, `Продолжи`) at exactly the moments when the working memory is
gone — after an interruption, after a compaction, or after you ended a turn
without finishing. Twenty such nudges across fourteen sessions of this project,
most of them in position 1–4 of a 2–5 prompt session, that is *inside* the
session rather than opening a new chat. Treat a bare "продолжай" not as
impatience but as "you left nothing to continue from".

## Choose the right container for the state

Three tiers, by lifetime. Putting a fact in the wrong tier is why it is never
found again.

| Tier | Where | What belongs there | Lifetime |
| --- | --- | --- | --- |
| **Memory** | the project memory directory (below) | durable facts that outlive the task: how a subsystem behaves, a trap, a preference | forever, indexed |
| **Checkpoint** | `.private/<topic>.md` in the main checkout | in-flight state of the *current* task: branch, SHAs, what is green, the next action | ends with the task |
| **Plan doc** | `docs/plans/<date>-<topic>.md`, status block | progress of a multi-stage effort | the life of the plan |

Rules that keep the tiers from collapsing into each other:

- memory holds **facts**, not procedures, and not the current task's state;
- a checkpoint holds **state**, not history — never a narrative of what you did;
- a plan doc holds **stages**, not turns.

`.private/` is local-only: excluded through `.git/info/exclude` and guarded by a
pre-commit hook that blocks any `.private/…` path. It lives in the **main**
checkout and is invisible from a worktree, so from a worktree write the
absolute path. It is not protected from `git clean -xfd`.

## The memory tier, exactly

```
~/.zcode/cli/memories/projects/<project-slug>/memory/
```

One file per topic, with frontmatter:

```markdown
---
name: <kebab-topic>
description: <one line: what this is, and when to recall it>
metadata:
  node_type: memory
  type: feedback | project | reference | user
  originSessionId: <session id>
---
```

Then the body: the observation, the concrete evidence (command, file, commit),
and a **How to apply** that a reader can act on.

Every file gets **exactly one line** in the sibling `MEMORY.md`, grouped under a
section, and grown no further — the index is a router, not a summary. `⚠` on the
line marks "read before publishing anything outward or touching the production
stand". When you add a file, update the index in the same change; when you
correct a file, update its line if the one-liner became wrong.

## The checkpoint tier, exactly

`.private/<topic>.md`, filled from `references/checkpoint-template.md`. It must
be actionable in a single read, so it stays short — 40 lines is the ceiling, not
the target. The sections that carry the value:

- **Objective** — one sentence in the maintainer's own words;
- **State** — branch, worktree path, `HEAD` sha, what is committed and what is
  not, and whose the uncommitted part is;
- **Verified** — each check with its number, and explicitly what is NOT verified
  (a checkpoint that hides an unverified claim is worse than a short one);
- **Decisions** — what was settled and why, so the next reader does not
  re-litigate it;
- **Open** — known failures with their symptoms;
- **Next** — the exact next action, concrete enough to be the first command;
- **Do not redo** — the searches and probes that already cost time;
- **Expiry** — when to delete the file.

## When to write

1. **Before a long run.** Any task that will outlive the current turn — a
   release wave, a refactor sweep, a subagent fan-out, a long test matrix. Write
   it first; then any interruption costs one read instead of a rediscovery.
2. **After every milestone**: gates green (with numbers), commit landed (with
   sha), merge done, decision taken, subagent returned. Mid-task checkpoints are
   cheap; a checkpoint written at the end of a long task is a reconstruction.
3. **When the context is filling.** The warning is the signal, not the rescue:
   by the time the summary is injected, the details you would have written are
   already compressed away.
4. **Before spawning a subagent.** A subagent starts with an empty context, so
   the checkpoint *is* its brief — this is the cheapest way to make delegation
   honest about constraints ("do not edit CHANGELOG", "only this package").
5. **Before ending a turn with the task unfinished.** Either continue, or write
   the checkpoint and stop with one line naming the file and the next action.
   Never end mid-task with a question and no state on disk — that is precisely
   the situation that produces a one-word nudge.

## Resuming

1. **Checkpoint first, repository second.** Read the checkpoint before any
   exploration; it exists to make the exploration smaller.
2. **Verify it against `HEAD`.** A checkpoint goes stale the same way a `git`
   snapshot does: another agent may have committed, merged or changed the plan
   since. Check the recorded sha and branch before trusting the state.
3. **One word, no checkpoint** — reconstruct in this order: the `MEMORY.md`
   index → `.private/` → `git status` / `git log --oneline` → the plan doc. Do
   not replay the original discovery; the point of a resume is to skip it. If the
   previous chat still exists, its transcript is readable by id — that is a
   fallback, not a substitute for a checkpoint.
4. **Update or close it before finishing.** A stale checkpoint that contradicts
   `HEAD` sends the next reader down a wrong path; a checkpoint whose task is
   done should be deleted, with anything durable promoted into the memory tier
   first.

## Anti-patterns

- **Duplicating the compaction summary.** Intent and concepts are already
  covered by the runtime; carry the operational residue instead — SHAs, paths,
  commands, verdicts, the next action.
- **A checkpoint longer than the work it describes.** If it does not fit on one
  screen, it will not be read.
- **Secrets in any tier.** Tokens, passwords and keys never go into memory, a
  checkpoint or a plan doc — refer to where the value lives, not the value.
- **State in a tracked file.** The state of an in-flight task does not belong in
  the public repository; stages belong in `docs/plans/`, state in `.private/`.
- **Todos as the only state.** A todo list does not survive into a new session
  and is not a handoff; it describes steps, not the situation.
- **A checkpoint as a diary.** "Then I ran X, then Y" is history. A resumer
  needs the current position, not the route.

## References

- `references/checkpoint-template.md` — the template, a filled synthetic
  example, and the update checklist.
- `references/resume-drills.md` — resuming after a compaction, in a fresh chat,
  and inside a subagent, plus the stale-checkpoint audit.
- Related skills: `shared-checkout` (whose state to record and whose not to
  touch), `release-plugins` (the wave shape that needs checkpoints most).
