---
"@yadsh/dsh-qa-surface": patch
---

The slash palette names the same skills in a chat that has not been woken as in
a chat that is running.

A chat this Host holds no live agent for — one reopened from disk, one its
visitor has not sent anything into yet — answered the palette read with "the
role system has no opinion", because the capability snapshot the role is read
from rides on the agent. Its catalog was therefore narrowed by the deployment's
allow-list alone, while the very same chat, once woken, was narrowed by that
allow-list *and* by the role. A visitor could read a skill name in the list,
type it, and be refused — or watch the list hide a skill the chat would have
accepted.

Both reads now resolve one grant. `policyForColdSession` walks the same session
record, the same role of the same account and the same model as the read of a
woken chat, and differs only in what it reads the role against: the catalog the
deployment mounts for every chat, since this chat contributes no agent of its
own. That is why nothing is written onto the session record — a palette read
must not freeze the capability snapshot a later turn runs under — and why what
only this chat's workspace contributes, its project layer and the account's own
skills the provider discovers under that workspace, stays out of the list until
the chat is woken: the palette's own read of a chat with no agent does not see
them either, so neither side of the comparison is left behind. A chat whose role
no longer exists refuses the read instead of showing everything, exactly as a
woken chat does.

The list itself is now derived in one place. `userInvocableSkillNames` is what
the palette is narrowed by and what `/name` is admitted or refused by, so the
two cannot drift into reading one rule two ways; an empty `userSkills` still
means the role keeps no separate user list, not that it grants nothing.

Covered by `tests/access/access-service-cold-session.test.ts` (a cold read
excludes a name no role grants, answers the same list as a woken read, refuses
a foreign browser, pins no snapshot) and by two cases in
`tests/slash/slash-remotes.test.ts` (a skill outside the grant stays out of a
read that has no agent, and the cold and woken reads agree).
