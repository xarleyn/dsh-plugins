---
"@yadsh/dsh-qa-integrations": minor
---

Add `bitrix_add_crm_timeline_comment`, the provider's first write tool, behind an operator switch that defaults to off.

QA tasks kept asking the agent to "add a note to the deal", and the agent — holding only read tools — promised a write it could not perform. The new tool adds exactly one comment to the timeline of a lead, deal, contact or company (`crm.timeline.comment.add`); smart processes and every other mutation stay out of the surface. It mounts only when the deployment sets `bitrix24.crmCommentWrite: true`, rides the new `crm.comment.write` capability, and even then starts policy-denied until the capability is explicitly allowed for the integration. Three gates, because Bitrix24 has no read-only webhook scope: a `crm`-scoped webhook can write on its own, so the flag — not the scope probe — is what bounds the deployment, and the policy is what bounds the user. The read catalog of thirty-nine tools is unchanged and stays mounted whatever the flag says.
