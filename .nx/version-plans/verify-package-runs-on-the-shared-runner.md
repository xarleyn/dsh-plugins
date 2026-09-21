---
"@yadsh/dsh-qa-browser": patch
"@yadsh/dsh-documents": patch
---

Two more package gates become manifests for the shared runner instead of copies
of it (#231).

`packages/plugin-scripts` has carried `runVerifyPackage` since the generator was
folded in, and 20 of the 26 `plugins/*/scripts/verify-package.mjs` already pass
their identity and expectations to it. The two largest scripts that still
hand-rolled the same manifest, patch, file, export and bundle-registration
checks - `dsh-qa-browser` and `dsh-documents` - now declare that contract as
options and keep only what their own package can promise in the `extra` hook:
the tool inventory and the defaults the browser runtime reads, and for the
document pipeline the installed subsystem, the in-process `documents` face, the
comparison tools, the skills that ship with it and the source scan that keeps
`comparison/` away from a process or a socket.

The runner gained the check those scripts kept re-writing: `exportsBuilt` makes
every export subpath point at a file that exists, so a declaration the build
never wrote fails here rather than only in a packing run. It also covers the
export `types`/`default` conditions, which is what the hand-rolled loops in
`dsh-documents`, `dsh-qa-integrations` and `dsh-qa-surface` did one by one.

Because a manifest now satisfies the card contract through
`clientBundle.cardContract` rather than by importing the module by path,
`verify-package-hygiene`'s client-contract gate learns that form too - it
accepts a script that reaches the runner with the option, and still refuses one
that only mentions the word.
