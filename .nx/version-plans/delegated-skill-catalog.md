---
"@yadsh/dsh-answer-review-gate": patch
"@yadsh/dsh-domain-experts": patch
"@yadsh/dsh-qa-surface": patch
---

A delegated assistant says out loud that it has no skill catalog.

The night browser round recorded that an answer reviewer and a domain expert see
an empty `<available_skills>` while their parent chat sees the role's list. The
cause is not the child's persona — the persona is exactly what travels. The
catalog is an agent-plane row: the harness publishes a model-facing list only
where the `skill` tool is visible in that agent's scope, and a delegated child
joins the parent's *preset* revision plus its own persona and `toolFilter`, so
none of the QA Surface shadow consumer — catalog, filtered loader, palette
enforcement — enters its chain. A delegated session is also refused attestation
by design (it has no owner to resolve a role from), so there is no policy to
install on it.

The catalog stays deliberately narrower than the parent's, and the difference is
now named instead of silent. A new surface test holds the three halves at once:
the attested agent gets the catalog with the loader and the gesture enforcement
beside it, attestation refuses a child, and the conversation ceiling still
bounds the child's tools. The admin console's «Что было доступно тогда» block
says whose agent its list describes, and the boundary is written up in the QA
Surface architecture and configuration docs and in both consumers' own specs —
including why naming the parent's skills in a child's persona is not a
workaround: without the shadow consumer the child would reach the standard,
unfiltered loader, which is wider than what the role grants its own chat.
Carrying the catalog into children means carrying the enforcement first.

`docs/plans/2026-10-08-delegated-skill-catalog.md` carries the diagnosis, the
wording for the harness vendor, and the follow-up this finding exposed: a child
whose own tool filter names `skill` can reach that unfiltered loader today,
gated only on operator configuration.
