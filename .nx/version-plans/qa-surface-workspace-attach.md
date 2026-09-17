---
"@yadsh/dsh-qa-surface": patch
---

Document where a per-user QA deployment puts its chats in the host UI, and give
the operator a way to repair the stragglers that are still adoptable.

`accounts.perUserWorkspace` hands every QA chat a private
`<workspace>/.qa-users/<account UUID>` root and deliberately does not register
it as a DSH Workspace. DSH grants Workspace membership only to a session whose
stored cwd IS the Workspace path (`Workspace.attachSession` compares the two
after `realpath`, and the workspace browser derives its groups from
`workspace.sessionIds` alone), so those chats appear under `Ungrouped` in the
host's sidebar. The mode is not misconfigured and nothing can move them
afterwards: the contract has no attach or membership request for an existing
session, `insertSessionBefore` reorders only sessions a Workspace already
accounts, and dragging a session never crosses groups. Registering one Workspace
per account directory is the one mechanism that would group them, and it would
put every visitor's scratch root into the operator's global workspace registry.
README, `docs/CONFIGURATION.md` and SPEC.md now state that consequence instead
of leaving an operator to rediscover it.

The second straggler family is repairable and now has a command. A chat created
while the deployment pinned `session.cwd` - or through `workspaceId` with the
same directory spelled differently (`E:/base` against `E:\base`) - never calls
`attachSession` at all, so it lands in `Ungrouped` even though its cwd IS the
Workspace path. `qa-attach-sessions`
(`scripts/attach-workspace-sessions.mjs`) adopts exactly those: it reads the
session store and the workspace registry, matches the stored cwd to a workspace
path after `realpath`, and writes the membership the host itself would have
written. Dry run by default; `--write` requires DSH to be stopped, keeps an
exclusive `*.pre-workspace-attach.bak` copy, replaces the registry atomically
and re-reads it before reporting success. Sessions below a workspace path are
reported and refused, because the host re-applies the same comparison on every
read and would drop them again; subagent sessions and archived sessions stay
untouched unless asked for. The command changes no plugin runtime behavior.
