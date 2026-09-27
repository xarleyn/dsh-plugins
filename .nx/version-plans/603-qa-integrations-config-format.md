---
"@yadsh/dsh-qa-integrations": patch
---

`src/config.ts` now matches the repository's Prettier style.

`pnpm format` — and with it `pnpm check` — reported this one file red on an
untouched train base, so every lane had to work out for itself that the failure
was not its own. The schema and the snapshot type are reflowed only: the
`maxResponseBytes` builder chain fits one line and the optional mapped-type
union no longer breaks. No literal, no default, no `.volatile()` marker moved,
and the resolved config the Host reads is byte-identical.

Nothing user-visible changed, so no release note is added.
