---
"@yadsh/dsh-git-readonly": patch
---

Read a selection of the session directory itself as no selection, and say so
when an instance has no repository roots at all. A QA session pinned to a
scratch directory that is not a repository — the per-user workspace layout —
now inspects the configured `repositoryRoots` entry instead of refusing when
the model names its own cwd as the repository; the refusal for any other
directory that holds no repository names the configured roots, and a refusal
with none says `this row exposes no repository roots`, which is how a
preset-mounted instance missing its own configuration is recognized.
