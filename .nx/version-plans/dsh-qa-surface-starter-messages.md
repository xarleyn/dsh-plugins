---
"@yadsh/dsh-qa-surface": minor
---

Let every account define its own starter messages.

The three pills above an empty composer were deployment-wide and
label-equals-prompt: `suggestedQuestions` is a list of strings where the text
on the button is also what pressing it sends. A user whose everyday request is
a long tracker query had no way to keep a short button for it.

The `Настройки` dialog gains a «Быстрые сообщения» section. Each entry is a
pair — the label the button shows and the prompt pressing it sends — and a
toggle hides the deployment's standard suggestions for that account. The list
is stored on the account next to its profile, replaces wholesale on save
through the new `accountsUpdateStarters` remote (token-scoped like the profile
write), and is projected to browsers on `QaAccountUserPublic`, so the composer
picks the change up without a reload. An anonymous visitor, a deployment with
accounts off, or one with the new `accounts.starters.enabled` flag off sees
exactly the previous behavior. The stored record is pure UI preference: unlike
the profile, none of it is injected into the agent prompt.

Validation and limits live in one browser-safe module (`src/starters.ts`) the
Host store and the editor form both import: at most 12 starters, labels up to
80 characters, prompts up to 2 000, and an incomplete pair — a label or a
prompt left empty — is refused on the write path and dropped on the read path,
so a hand-edited accounts file never yields a dead button.
