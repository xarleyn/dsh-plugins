---
"@yadsh/dsh-answer-review-gate": patch
---

The reviewer child follows the QA model policy where its own configuration is
silent.

`reviewer.{provider,model,route,reasoningEffort}` stays the deployment's fixed
answer for the reviewer — a reviewer that changed with the role it was reviewing
would be a worse check, not a better one. What the gate could not do was say
anything when that configuration named no model: the child then inherited the
parent's live selection, which is the model some visitor had left in the picker.

`createSubagentBackend` now takes the pair the QA policy fixes for the chat under
review, read structurally from the host's `qaSurface` (`qa-policy.ts`, the method
optional so an installed QA surface that predates policies reads as "no opinion"
rather than as a failure). The policy applies only where the gate's own `model`
stays empty; the reviewer's route override still wins, and the audit line names the
pair the review actually ran on.

Covered by `tests/qa-model-policy.test.ts` (no surface, no method and a blank pair
all read as silence; the policy's pair reaches the child when the configuration is
empty; a pinned reviewer model ignores the policy; nothing is sent where neither
speaks).
