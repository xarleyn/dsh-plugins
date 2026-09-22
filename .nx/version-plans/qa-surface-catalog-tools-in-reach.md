---
"@yadsh/dsh-qa-surface": patch
---

A tool the plugin attaches to the chat is callable in a role-bound chat.

The QA tool catalogue — the documentation readers, the workspace-fenced delete,
the activation diagnostic — is registered on the agent itself, so no role list
carries it and no scoped restriction can name it. Two layers decide whether a
call to it runs, and in a chat that attests a role only one of them knew it: the
grants admit a catalogue tool for as long as the policy holds, while the
conversation ceiling was built from the deployment's pinned list, the role's own
tools and its grantable reach. A catalogue tool therefore sat inside the chat
and outside the ceiling, and every call to it was refused as "outside the
capability profile of this conversation" — a refusal that names a profile the
caller cannot see the gap in, on a deployment that attaches the catalogue at
session start.

The ceiling now includes the catalogue names the plugin attaches, exactly as the
account-free path already did, and the profile guard reads them from the calling
agent's own catalogue in a role-bound chat too. What the catalogue did not
attach is unchanged: it stays the role's to allow, and a refusal there still
names the execution profile.
