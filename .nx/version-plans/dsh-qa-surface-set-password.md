---
"@yadsh/dsh-qa-surface": minor
---

Give the accounts CLI a way to reset a password. The store keeps only scrypt
hashes, so the `qa-accounts` command set could create an account and change its
role, but nothing could put a password back: a QA user who forgot theirs was
answered by an operator hand-editing `qa-accounts.json`, and dropping the entry
to re-add it would have minted a new account id and stranded every chat that
account owned in the ownership map.

`qa-accounts set-password <email> --password-stdin` rehashes in place. The
account keeps its id, so its profile and its claimed chats stay its own, while
the password it replaces and every token minted under it stop working: the token
version bumps, exactly as it does on `disable` and `revoke`, so a reset doubles
as the single-step answer to a leaked credential. The address is validated like
`add` — a weak password is refused with `weak-password` and leaves the stored
one untouched — and the password is read from stdin, one line, so it never lands
in shell history.

The length rule now lives in one shared `validatePassword`, used by
registration, `addUser` and the reset, so a password good enough to register is
exactly the one an operator can put back. `docs/CONFIGURATION.md` and the
accounts spec list the new command alongside the rest of the operator set.
