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

A scoped restriction and a scoped guard cover the scope that owns them and its
descendants only, and a delegated child is composed from the parent's preset
rather than from the parent agent (`applyChildComposition`), so the parent's
layers never enter the child's chain: an expert was bounded by its preset
`toolFilter` alone and could hold — and call — a tool the subrole never
granted the chat. An attested conversation now carries a ceiling of its own,
held in the admission and inherited by every child session, and a context-global
guard denies every agent of that conversation anything outside it. The ceiling
is the subrole's reach: its visible tools plus the ones a skill may grant it, so
a delegated assistant can still be handed a tool by a skill and can never exceed
what the role could ever grant. The session's own policy list rides along, which
keeps the provenance reporter available to delegated runs.

The deployment's pinned `toolPolicy.allow` reaches every profile, so a pinned
tool — the read-only `dsh_git_*` provenance tools, for one — could not be
withdrawn by unchecking it in a role: the operator had to edit the profile and
restart the Host. `tools.deny` is the third tool class and the way out. A denial
beats every grant, the pinned set and the Common layer included, and it narrows
the skill-grantable ceiling, so a skill cannot hand back what the profile
withdraws. A denial in a role applies to that role, one in Common to every
profile, and both shrink the conversation ceiling, which is what takes the tool
away from that role's experts as well. Both editors and the effective-access
view report it, and a user page subtracts it from the counts it shows.
