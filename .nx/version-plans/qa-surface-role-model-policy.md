---
"@yadsh/dsh-qa-surface": patch
---

The provider and model are fixed by the role, not by the deployment.

One pair served the whole stand: `session.provider` and `session.model` were read
as they were configured and handed to `sessionController.selectModel` at both
places a chat opens, so accounts-technical-support answered on the same paid model
as everyone else, and nothing in the role system carried a model at all — the
subrole was already known when the pair was picked (the account's role is reserved
before the session is created), but it said nothing about models.

A role now carries a pair, and an account may carry one above it. Resolution is
`modelPolicyFor(sessionId)`: the account's pair, then the pair of the role the chat
was reserved under, then the deployment's, then nothing — and it runs *before*
`selectModel` at both entry points, the browser's `createSession` and the
integration API's `openChat`, which is where both used to read the config as it
stood. The layer that answered is written with the pair to the journal, so the
first question of a chat can be traced to the role or the account that fixed it.

A named pair is checked against the harness model catalog. Writing it is refused
at the save — in the role editor, in the assignment, and from the admin console's
user card — with the providers that do offer the model named, and the same check
runs again when a chat opens, which refuses the chat rather than letting it fail on
its first question with a message that names neither the pair nor where it came
from. The administration surface offers no free text: the pair is picked out of the
catalog, and a pair already stored but no longer served stays listed, marked,
instead of being dropped by an editor that cannot see it.

`lockdown.enforceFixedModel` compares the live agent's selection against the
session's own policy instead of against one global pair, keeping the switch's
meaning: a visitor cannot move to a model outside their policy. A pair that names no
reasoning effort constrains provider and model only, which is how the single-pair
check already read.

Delegated launches read the same policy through `modelPolicyForSession(sessionId)`
on the QA surface, so a subagent whose profile names no model follows the role
rather than inheriting the parent's live selection. Rewriting the pair of a child
that is already running is a harness change — this repository does not touch
`GenerateOptions` — so the policy reaches delegations started after it was written,
and a turn already in flight finishes on the model it started with.

Covered by `tests/access/model-policy.test.ts` (pair normalization, layer priority,
catalog refusal and its wording, the fixed-model check),
`tests/access/access-service-model-policy.test.ts` (two roles opened on two pairs,
the account above its role, the deployment under both, refusal stored nowhere),
`tests/session/session-model-policy.test.ts` (selection applied, skipped without a
pair, refused before the Host is asked), and
`tests/client/admin-console/qa-admin.test.tsx` (the role editor writes a pair chosen
from the catalog).
