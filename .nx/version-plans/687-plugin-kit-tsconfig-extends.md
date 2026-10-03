---
"@yadsh/dsh-plugin-kit": patch
---

The package inherits the shared TypeScript preset by its path inside the workspace
instead of by its package subpath, which is what lets its test suite compile at all
on Windows.

Vite lowers TypeScript with the tsconfig `rolldown` resolved, and that resolver
walks `extends` through the `node_modules/@yadsh/dsh-config` workspace link while
folding a relative hop against the link rather than against its target. The preset
`tsconfig/base` extends the repository's root config, so inheriting it by subpath
sent the search for that root config outside the tree —
`node_modules/tsconfig.base.json`, which is not there — and every test file of the
package failed before a single assertion ran. `tsc` canonicalises the same path and
never sees the defect, so `build`, `typecheck` and the shipped bundle stayed green
over a red suite; a POSIX resolver folds `..` along the already-resolved path, so
the mirror run on Linux was green on the same commit.

Nothing about the compiler options changes: the two forms resolve to the same
preset, checked by comparing `tsc --showConfig` before and after. The published
tarball carries `lib/`, `README.md` and `LICENSE` only, and the tsconfig is not
among them, so the artifact is byte-identical. `@yadsh/dsh-test-kit` and the plugin
generator made the same move but are private and need no plan. No runtime change.
