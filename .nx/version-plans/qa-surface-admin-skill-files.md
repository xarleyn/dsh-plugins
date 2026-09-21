---
"@yadsh/dsh-qa-surface": minor
---

Skill files became something an administrator can edit, and a person can tell
when theirs was edited by somebody else.

The console gained a "Редактор навыков" section. It writes the deployment's own
shared skills — a store that sits beside the registered workspace, is offered
to the model by the same discovery provider as a personal one, and is labelled
`qa-shared` so a loaded skill names where it came from — and it writes the
personal skills of any account, chosen from the account directory. Neither is a
second editor: every call goes through the storage service the owner's own
settings page uses, so path checks, draft validation, revision conflicts,
trash-on-remove and catalog invalidation are the same code, and a shared skill
ranks between a personal one and the checkout's own layers (60 against the
personal layer's 50 and the project layer's 100).

Editing somebody else's file is a write on their behalf, so it is not silent.
Each administrator write leaves a mark beside the skills it describes
(`.admin-edits.json`, a dot entry no skill enumeration can mistake for a skill),
keyed by directory name and carrying the revision it produced, and the owner's
catalog shows "Изменено администратором" with the date while the stored bytes
are still the administrator's. The owner's own save clears it, because the
question the mark answers is "did an administrator write what I am looking at",
not "was this file ever touched". Renaming a skill moves the mark with it;
removing one drops it.

Authorization is its own permission, `skills.manage`, held by the admin role and
deliberately separate from `settings.manage` so a future curator role can hold
one without the other. Every write appends an audit row (`skill.created`,
`skill.updated`, `skill.deleted`) naming the actor, the skill, the store and the
account it belongs to, with before and after images that carry the revision and
the description but never the body: the trail records who changed which
instructions, not a second copy of a person's instructions.
