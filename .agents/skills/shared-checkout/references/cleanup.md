# Cleaning up without losing anything

Cleanup runs after a merge, when the valuable things are exactly the ones that
are not in git. Order matters: inspect, then detach, then delete.

## Before removing anything

The question is never "is this directory dirty" but "does it hold anything that
is not reconstructible".

```bash
git status --porcelain --untracked-files=no     # foreign uncommitted work
git worktree list
git branch -vv                                   # which worktrees are unpushed
```

Then sweep for what git ignores, at full depth — a local `.env` with stand
credentials, a local database, a backup of a config file. Build output
(`node_modules`, `lib`) is disposable; keys and databases are not. If the
directory holds foreign uncommitted work or an ignored artifact of unknown
value, stop and ask instead of deleting.

Also check whether the branch itself is already merged: a worktree can be
deleted while its branch still carries unmerged commits. Keep branches you are
unsure about — a local branch costs nothing.

## Removing a worktree

On Windows `git worktree remove` routinely untracks the worktree and leaves the
directory fully intact, reporting `error: failed to delete '<path>': Directory
not empty`, with the whole checkout still inside — not just leftovers. So:

```bash
git worktree remove <path>      # may untrack only
rm -rf <path>                   # finish the job
git worktree prune              # finds nothing extra; harmless
```

Two traps:

- **`rm -rf` fails with `Device or resource busy`** when a nested directory is
  held by a live process. Wait for the holder to exit (see the main skill on
  foreign processes); until then the directory is still on disk and the cleanup
  is unfinished — say so rather than retrying forever.
- **Junction/symlink directories must be unlinked before the tree is removed.**
  A recursive delete follows a junction into the real `node_modules` and wipes
  it. Remove the link itself (`fs.rmdirSync(link)`), then remove the directory;
  removal tools fail with `Directory not empty` until the links are gone.

Verified order that works: remove the junctions first, then the worktree, then
`rm -rf` the residue, then `git worktree prune` and `git branch -d` for the
merged branches.

## Keeping work that only exists in a worktree

Before any of the above, push the branch or move the commits to a named backup
branch. Do not rely on the worktree path staying around: an unreferenced set of
commits is reachable only through the reflog, which is easy to lose and hard to
explain afterwards.

## Worktree-mode discipline for the next session

- pin the prefix of the working directory and match it against every write;
- run builders from inside the package directory, and confirm the artifacts
  exist rather than trusting the exit code;
- a new worktree is not a clean slate: shared packages are not built, the
  line-ending attributes may be missing from an old base, and the tooling may
  resolve a different checkout. Do the setup in the first minutes, not after the
  first red gate.
