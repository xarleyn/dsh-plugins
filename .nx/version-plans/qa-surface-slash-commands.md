---
"@yadsh/dsh-qa-surface": minor
---

Add the slash interface — user-invocable skills and admitted human commands —
as an opt-in layer over the native DSH mechanisms.

The QA composer had one path, `sendPrompt`, and a guard that turned every
`/`-leading line away. That guard is still the default: the interface is off
until `lockdown.allowSlashCommands` is turned on, and a deployment that upgrades
without touching it behaves exactly as before. When it is on, `/generate-tkp …`
becomes an ordinary `Session.prompt` carrying the gesture, so the native skill
consumer injects the instructions and QA reads no `SKILL.md` of its own; and an
admitted `/compact` goes to the native command runtime, which never turns it
into a model message and whose `command/run` / `command/done` pair is projected
from the session log as a control row rather than a bubble.

Admission is the Host's, twice over. `slashCatalog` answers with a catalog
already cut down by `slashCommands.skills` / `slashCommands.commands` and by the
chat's role, and `slashExecute` re-derives the command name from the line it is
given and re-checks the policy against the deployment's own config, so a
hand-typed name the palette never showed is refused rather than run. Commands
default to `deny-all`: a plugin installed on the Host must not put its own
control-plane command in front of a user who was never offered it. Skills
default to an empty allow-list too, and the one case that widens anything —
`allowSlashCommands: true` with no `slashCommands` section at all — admits every
user-invocable skill of the chat and still no commands, and says so once in the
Host log.

`lockdown.allowSlashCommands` is now a real switch. It was pinned at `false` by
a schema constant and by a resolver that refused `true` outright, which made it
dead configuration; it stays off by default and opens nothing by itself, because
what it admits is a second, separate decision. Nothing else moved: the sandbox
mode, the tool allow-list, the permission preset and the approval policy are
untouched, and a skill invoked by hand carries exactly the permissions it
carries when the model loads it.
