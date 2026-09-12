---
"@yadsh/dsh-git-readonly": patch
---

Make the read-only guarantee reproducible in CI. The mutation suite snapshots
a throwaway repository before and after every tool call, and `git commit` in
that fixture ends by spawning a detached `git maintenance run --auto` that
holds `.git/objects/maintenance.lock` until it exits. On a loaded Linux runner
the daemon outlived the commit, so the lock landed inside one snapshot but not
the other and the suite failed over a file no tool wrote. The fixture now
pins its repositories against auto-maintenance, snapshots compare file by file
so a failure names the paths that changed, and directory walks no longer
depend on readdir order.
