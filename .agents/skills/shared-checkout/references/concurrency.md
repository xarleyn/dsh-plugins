# Living with a parallel writer

Symptom catalogue for a checkout that changes under you, with the diagnostic and
the fix for each. All of these look like "my change broke something" and are
usually someone else's middle of an edit.

## The tree churns between your calls

Typical shape: the `git status` you took at session start showed plugin A
modified; an hour later the same command shows plugin B — plus an untracked
directory that is not in `HEAD`, plus a version plan you did not write. By the
time you commit, the other writer has committed part of it themselves.

Consequences to fold into your routine:

- a session-start snapshot is not a baseline for anything;
- `prettier --check` / a full test run going red on paths that are not yours is
  a *foreign red* — report it as such, isolate your own scope
  (`nx run-many -t <target> --exclude=@yadsh/<their-project> --skip-nx-cache`)
  instead of "fixing" their files;
- an assertion in a shared file may be checked against their half-written
  content; re-read the file, re-run, and compare against `git show HEAD:<path>`.

Their commits can absorb a line you just wrote but had not committed yet. After
any of their commits appear, re-run whatever check derives an artifact from the
sources (a generated manifest, an index) and regenerate it before reporting.

## Their commit swallowed mine

Diagnostics, ten seconds:

```bash
git show -s --format="%an %ad %s" HEAD   # whose name is on it
git show --stat HEAD                     # does the inventory include your files
git log --oneline -3
```

If your files are inside their commit, your work is in `HEAD` and not lost.
Unwinding:

```bash
git log --oneline -3                 # re-read immediately before the reset
git reset --soft HEAD~1              # commit becomes staged changes
git restore --staged <their paths>   # theirs back to unstaged
git add <your paths> && git commit …
git add -A <their directories>       # return their set to the index
```

The composition of a mixed commit is often **incomplete**: while you were
looking, their amend added more files. After the reset, extra paths of theirs can
appear in the working tree — that is not data loss, and not a reason to abort.

## Their staged set rides into your commit

`git add <your paths>` does not protect you from a **foreign staged** set: the
index already holds their rename or their new files, and your commit takes the
whole index.

- check the first column of `git status --short` before committing;
- prefer `git commit -F <message-file> -- <paths>` (implies `--only`) when their
  content is already staged, so only your paths are committed;
- if it happens: `git reset --soft HEAD~1`, `git restore --staged <their paths>`,
  commit yours, hand theirs back with `git add -A <their directories>`.

## `--amend` during a rebase rewrote the wrong commit

Symptom: the PR shows foreign merged commits as if they were yours, the branch
no longer descends from `origin/<base>`, and CI is green anyway because the
content is correct.

Diagnostics:

```bash
git merge-base --is-ancestor origin/<base> HEAD   # must be YES
git rev-list --count origin/<base>..HEAD          # must equal your commit count
git log --oneline origin/<base>..HEAD             # no foreign merge commits
git log --oneline -S"<marker of your edit>" -- <file>
```

Recovery without losing work:

```bash
git branch -f backup-<branch> HEAD                    # pin the correct content
git rebase --onto origin/<base> <broken-commit> <branch>
git diff --stat backup-<branch> HEAD                  # must be empty afterwards
```

Reapply whatever was folded into the broken commit as its own commit (backup
branch, then `git diff --stat` proves byte equality). Keep the backup branch
until the PR is merged. After any rebase, re-run the diagnostics above before
pushing, and push only `--force-with-lease`.

## A zombie session keeps writing

Symptom: scaffolding appears in your worktree in the middle of your session, or
a write fails with "modified since read" on a file you never touched. The
maintainer may believe no chat is active while an archived one is still writing.

Sequence that works:

1. confirm it is a writer, not a glitch — poll mtimes twice with a pause
   (`find <dir> -newermt '-5 min'`);
2. ask the maintainer which session owns the writer; overwriting a live session
   is not your decision, and neither is racing it;
3. if it is an abandoned session, wait for a quiet window and inherit its result
   (review, gates, docs, commit) instead of restarting the work.

## Worktree mode: the wrong-checkout trap

In a worktree, record the full prefix of your working directory and match it
against every write. The gates can be green in the wrong directory, so content
is the only reliable tell. Restore a file you broke in the wrong place with
`git restore --worktree <path>` — not `git checkout -- <path>`, which stages a
foreign untracked path as a side effect.

Two more worktree-only hazards that masquerade as your regression:

- a build taken from a second checkout can report success while producing
  nothing in *your* tree (the runner resolves the workspace elsewhere) — verify
  the artifacts physically exist (`find plugins packages -maxdepth 2 -type d -name lib | wc -l`)
  and run builders from inside the package directory;
- a fresh worktree from a branch older than the line-ending attributes comes out
  with CRLF and fails on `SyntaxError` in `.mjs` tests. Compare the file with the
  main checkout (`cmp`) before claiming a regression, and repair line endings at
  the start of the session rather than after the tests fall over.

## Running gates while the tree is dirty

- Re-run a red gate before reporting it: half-saved edits of theirs produce
  single failing tests that pass in isolation.
- A package-wide check cannot be reported green while their files are dirty;
  probe formatting by naming your own paths and report the foreign red
  separately.
- Do not run a formatter over the whole repository while foreign markdown is in
  flight: it rewrites their files too. Format only the paths you changed, and
  disclose any incidental normalization instead of reverting their file.
- Always state which gates ran with which numbers, and that the run describes a
  dirty tree rather than a clean index.
