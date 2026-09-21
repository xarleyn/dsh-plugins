---
name: shared-checkout
description: Work safely in this checkout while other agents and the maintainer
  edit it at the same time — stage only your hunks, keep their uncommitted WIP
  alive, never purge their processes or worktrees, and clean up after a merge.
  Use when the request mentions another agent ("другой агент уже делает",
  "закоммить только свои правки", "не трогай мои запуски", "в дереве чужой
  WIP"), when you are about to commit in a tree you did not fill, when an amend
  or a foreign commit may have swallowed your work, or when a stale worktree or
  branch has piled up and needs cleaning.
---

# Working in a shared checkout

This checkout is shared: the maintainer runs several agents against the same
working tree, edits files himself while you work, and commits on top of you.
Nothing about the tree is yours except the hunks you write.

**The one invariant:** `HEAD` is the only shared truth. The working tree is a
scratch pad that two writers happen to share, so any observation of it — a
`git status` from the start of your session, a red test, a dirty file — can be
another writer's half-saved moment rather than a fact about the repository.

Two failure modes cost the most here, and both are avoidable:

- **sweeping**: your commit carries their uncommitted work (or their staged
  set rides into it), which breaks the build for everyone;
- **overwriting**: your edit lands on top of their unsaved change, or your
  cleanup deletes work they have not committed.

## 0. Pre-flight, before every commit and every regression claim

```bash
git status --short
git log --oneline -5                 # their commits may already be on top of you
git diff --stat                      # both writers, no attribution
```

- Never trust a snapshot taken earlier in the session — it goes stale in both
  directions. Right before staging, re-read `git diff <file>` and
  `git log --oneline -5`.
- Before calling a gate failure real: compare the file with `HEAD`
  (`git show HEAD:<path>`), re-run the gate, and check `git status --short` for
  a foreign file being written at that instant. A single red test that passes in
  isolation is usually their in-flight edit.
- Before concluding that a previously dirty file "disappeared": check
  `git show -s --format="%an %ad %s" HEAD` — they commit their own work
  mid-session, and a clean tree is not evidence that WIP was lost.

## 1. Stage by explicit paths. Never `-A`.

- `git add -A`, `git add .` and `git add <directory>` are forbidden. A directory
  drags their brand-new untracked files into your commit; `-A` takes everything.
- `git add` with at least one non-existent pathspec silently adds **nothing**
  (and returns non-zero). Never silence it with `2>/dev/null`, and never mix
  existing and missing paths in one call.
- Assert the staged set instead of trusting it:

  ```bash
  git add <explicit paths> \
    && [ "$(git diff --cached --name-only | wc -l)" -eq 3 ] \
    && git commit -m "…"
  ```

- `git commit -F <message-file> -- <paths>` implies `--only`, so your files land
  while their already-staged rename stays staged and untouched. A brand-new file
  still needs `git add` first.
- Watch the first column of `git status --short`: a foreign **staged** set in the
  index rides into your commit even when you `git add` only your own paths.
- Read `git diff --cached` with your eyes before committing. It is the last
  place where a foreign line is cheap to notice.

## 2. Shared files: two modes, decided by the ask

| The request | What to do |
| --- | --- |
| "commit these files / commit it entirely, as a separate commit" | commit the **whole file**; their edits in the same files wait for their own commit |
| "commit **only my** changes" | cut **inside** the file; their lines stay in the working tree |

Both modes end the same way: `git status --short` shows their work still
present, and the handoff names what stayed uncommitted and whose it is.

Cutting inside a file has several recipes — patch straight into the index,
reverse their hunks out temporarily, or surgery on generated files such as
`pnpm-lock.yaml` that no one can hand-split. Symptom-to-fix recipes, including
the hunks classification trap, are in `references/staging.md`.

A green gate run in a dirty tree describes `HEAD` + your additive change, not a
clean index — say that in the handoff instead of presenting it as a verified
snapshot.

## 3. When their commit swallows yours

Symptom: `git log --oneline -1` shows their subject or their name, but
`git show --stat HEAD` lists your files. Their `--amend` or `add -A` absorbed
your work; it is in `HEAD`, not lost.

Untangle it by soft-resetting the commit, staging back only your paths,
re-committing, and returning their set to the index — and re-read
`git log --oneline -3` immediately before the reset, because their amend may
still be adding files. The full recipe is in `references/concurrency.md`.

Corollary: check `git show --stat HEAD` before your own commit, and do not
propose an `--amend` while a parallel session is live.

## 4. `--amend` rules

- **Never amend history that has been pushed.** The maintainer cancels amends
  mid-thought ("not amend, the history is already out") — land a new commit.
- **Never `--amend` while a rebase is stopped.** `HEAD` is detached on the
  commit being replayed, so you rewrite a *foreign* commit and your branch stops
  descending from `origin`; CI stays green because the content is still correct.
  On a rebase stop: `git add <files>` + `git rebase --continue`, nothing else.
- Message-only amend: `git log -1 --format=%B > <message-file>`, edit, then
  `git commit --amend -F <message-file>`.

## 5. Never touch their processes or rigs

Servers, dev rigs and containers started by the maintainer or by another agent
are off limits: no kill, no restart, no "I will just bring it back up". Ask
first, and prepare everything so the restart is a single step.

What you may do without asking: request an authenticated URL from the
maintainer, inspect the running page (console, geometry, computed styles), read
the plugin's logs, and run read-only probes.

Which change needs a restart is the useful distinction to report:

- **client-side change** — verifiable live: build, reload the page, look at the
  real UI;
- **host-side change** — will not appear in a live UI without a restart, so
  verify it with tests and end the report with "needs a restart", leaving the
  restart to them.

The same restraint applies to file locks: a `rm -rf` that answers
`Device or resource busy` means someone is holding that directory. Wait, and
report the cleanup as unfinished rather than retrying harder.

## 6. Detect a second writer instead of guessing

- A file changes between two of your calls, or a write fails with "modified
  since read" on a file you never touched: that is a writer, not a glitch.
- Confirm by polling mtimes twice with a pause:
  `find <dir> -newermt '-5 min'`.
- Ask before overwriting — this is a decision only the maintainer can make
  (their live session vs an archived one that keeps writing). If the writer is
  an abandoned session, wait for a quiet window and inherit its result rather
  than racing it.
- In worktree mode, pin the prefix of your working directory and check it
  against every write: editing the wrong checkout is invisible in the gates,
  which can be green in the wrong directory.

## 7. Cleanup after a merge

- Worktree removal on Windows routinely untracks the worktree but leaves the
  directory intact (`Directory not empty`); `rm -rf` finishes the job and
  `git worktree prune` finds nothing extra.
- Remove junctions and symlinks *before* touching the directory
  (`fs.rmdirSync(link)` — a recursive delete follows the link into the real
  `node_modules`).
- Before deleting anything, look for what is not in git: foreign uncommitted
  work (`git status --porcelain --untracked-files=no`) and ignored valuables
  (local `.env`, local databases). Build output is disposable; credentials are
  not.
- Keep the backup branch until the PR is merged — it costs nothing locally.

Details, including the junction recipe and the object-safety sweep, are in
`references/cleanup.md`.

## 8. Handoff

The report ends with three facts, always:

1. what remains uncommitted in the tree **and whose it is**;
2. which gates ran, with their numbers, and which were skipped because the tree
   holds foreign WIP;
3. push and release state — nothing is pushed unless it was asked for.

Do not push on your own initiative, and do not fold publishing into "commit":
a bare "commit" does not authorize a release. Conversely, a short verb chain
("commit, push, run the release, watch CI") means do all of it without
intermediate questions. Never claim a restart you did not perform — if the
maintainer restarted it, that information came from them.

## References

- `references/staging.md` — every recipe for "commit only my hunks", the
  generated-file surgery, and how to verify the staged set.
- `references/concurrency.md` — foreign commits absorbing yours, the
  rebase-amend hazard with its 10-second diagnostics, and zombie writers.
- `references/cleanup.md` — removing worktrees and branches after a merge
  without losing anything that is not in git.
- Related skills: `create-plugin` (commit conventions for this repo),
  `release-plugins` (pushing and publishing).
