---
"@yadsh/dsh-git-readonly": minor
---

Allow every provenance tool to inspect an explicitly selected repository
without turning the selector into a filesystem escape. The new `repository`
argument resolves relative to the session cwd and is accepted only when both
that directory and Git's resolved work-tree root remain inside the session cwd
or an operator-configured `repositoryRoots` entry. Calls without the argument
use the session repository first and fall back to the only configured root;
multiple roots require an explicit choice. Denied or invalid selections carry
stable typed errors with a recovery hint.
