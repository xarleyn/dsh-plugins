---
"@yadsh/dsh-qa-surface": patch
---

Keep one leading separator on POSIX source paths. The lexical canonicalizer
shared by the evidence bundle, the reported-source validation and the file
preview prefixed an absolute POSIX path with a second `/`, so on Linux
deployments a source read from a shared read-only root was echoed as
`//shared/...` and the preview assertion failed the Linux CI leg. A drive
spelling keeps its canonical `c:/` form and workspace-relative spellings are
unchanged.
