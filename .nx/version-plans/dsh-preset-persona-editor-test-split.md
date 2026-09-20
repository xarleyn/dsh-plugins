---
"@yadsh/dsh-preset-persona-editor": patch
---

Internal cleanup: the package's oversized test files are split into per-domain
files with shared helpers (`prompt-sections`, `composition`, `client-store`,
`preset-files`). No runtime behavior changed.
