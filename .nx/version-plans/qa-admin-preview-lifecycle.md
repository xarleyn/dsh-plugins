---
"@yadsh/dsh-qa-surface": patch
---

Keep the administrator preview inside the chat it was asked for, and report a
profile's effective capabilities the way a session resolves them.

`Preview as role` wrote a marker into a history entry, but the surface read it
once, on mount, and latched the mode in component state. Nothing ever cleared
it: the role selector — the one control that names the profile in force — is
hidden while previewing, the corner banner carried no way out, and so every
later new chat in that tab was created as a preview of the previewed profile
instead of the account's default one. A chat could therefore run as `Общий`
while its owner's default profile was another, with the preview banner the only
sign of it. The mode is now a property of the history entry: a preview
navigation enters it, an entry without the marker leaves it, an account that is
not an administrator never holds it, and the banner carries a `Выйти из
просмотра` control that returns to the account's default profile.

The same marker was validated against the roles the signed-in administrator
holds, although the Host allows previewing any enabled role — so previewing a
role the administrator is not assigned to silently fell back to the default
profile and told nobody. The marker now carries what it needs and the Host stays
the authority on who may preview what.

`Действующие возможности` on a user page counted the configured lists alone,
against the whole registry. It reported `0 инструментов` for a profile whose
chats resolve the deployment's entire pinned allow-list, counted the
skill-grantable ceiling as if those tools were already visible, and ignored the
skills that reach a role by declaring it in their own `SKILL.md`. The counts now
follow the same resolution a session uses — pinned set plus Common plus the role
for tools, the ceiling separately, declared audiences included for skills.
