---
"@yadsh/dsh-qa-surface": patch
---

Keep «Файлы» next to the tabs it belongs to instead of stranding it mid-row.

Two header buttons each claimed the row's free space with `margin-left:auto`:
«Новый чат» (or, when a deployment hides it, the files control through its
`--end` variant) and «Администрирование». A flex row hands its free space to
every auto margin in it, so the space split into two equal gaps and the files
control — the sibling tab of «Источники», opening the other page of the same
right rail — floated alone between them, in no group at all. Whether it drifted
depended on an unrelated switch (`ui.showReset`, a fixed session policy or a
lockdown without `allowSessionReset`), so the same button sat with the tabs for
one deployment and in the middle of the row for the next.

The row now carries one right-hand cluster with a single auto margin, and the
files control stays with «Агенты» and «Источники» in every configuration.
