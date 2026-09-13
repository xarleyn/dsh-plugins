---
"@yadsh/dsh-qa-surface": minor
---

Give QA accounts a self-declared profile. `accounts.profile` collects a full
name, one handle per external system the deployment declares, and free-form
instructions about how the account wants answers; the owner edits them from the
sidebar footer, and the deployment decides which handle fields exist and how
long the instruction text may be.

The Host injects both into the QA agent's system prompt: one section names the
user with their email and handles, a second carries the user's own wording
framed as preferences that cannot move tools, permissions, the sandbox, or any
rule the deployment set. Both are re-resolved on every prompt assembly, so a
profile edit lands on the next turn, delegated experts included.

The account token is the only identity on the wire, so a browser can write
nothing but its own profile, and the prompt says the values are self-declared
rather than verified directory attributes.
