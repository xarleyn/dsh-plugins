---
"@yadsh/dsh-session-scope": patch
---

The isolated Linux backend now hides the workspace from itself.

`isolated` masked the session workspace with mounts: the selected roots are
staged, the workspace is covered with an empty tmpfs, and the chosen roots are
bound back over it. That leaves the mount path as the only thing doing the
hiding. While the confined process shared a PID namespace with the host, every
unconfined process of the same UID stayed addressable inside the sandbox as
`/proc/<pid>` — and `/proc/<pid>/root` is that process's own root, so it is a
second path to the very workspace the tmpfs just covered. Whether a same-UID
reader may actually resolve the link is decided by Yama, `hidepid=` and the
target's dumpability, which means the guarantee the plugin advertises was being
granted by whichever host it happened to run on rather than by the sandbox.

The isolated profile therefore takes a PID namespace of its own: the rewritten
argv carries `--unshare-pid` alongside the provider's `--proc /proc`, so the
mounted procfs belongs to the new namespace and the confined process meets no
outside pid at all. The route is gone on every host, not only on strict ones.
Both isolated shapes get it — the narrowed view and the whole-workspace
selection — and the capability probe runs exactly this argv, so a kernel that
cannot create the namespace reports `isolated` as unavailable and fails closed
instead of promising a weaker isolation than the mode means. The recognized
provider profile is untouched: what has to match the host's own bwrap output is
the input, and the plugin still owns only the narrowing.

A fixture holds the line where the claim is made. Under bwrap it runs the same
probe twice — once in the provider's profile, once in the isolated one — against
an unconfined bystander of the same UID: the confined process must share the
host's PID namespace and be able to name the bystander by its argv in the first
run, and must be in a different namespace and unable to name it in the second,
with the hidden file unreachable and the selected file still readable. The
comparison is deliberately about the namespace and the addressability, not about
whether the bystander's proc-root read succeeds: that answer is the host's
policy, and a test asserting it would pass or fail for reasons this package does
control nothing of.

What `isolated` still does not promise is unchanged: a `read-only` permission
mode keeps the rest of the host filesystem visible, processes outside the
sandbox are not restricted by it, and memory of the confined process is readable
by whoever could read it before confinement.
