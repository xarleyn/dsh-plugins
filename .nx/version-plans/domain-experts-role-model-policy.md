---
"@yadsh/dsh-domain-experts": patch
---

An expert domain that inherits its model inherits the chat's model policy, not the
chat's model.

`DomainModelConfig.inherit` is the default, and inheriting meant taking the parent
agent's live `provider`/`model` — a fact about what the visitor had picked, not about
what the deployment decided. The QA surface already answers for a session
(`qa-principal.ts`); it now also answers `modelPolicyForSession(sessionId)`, declared
optional so an installed surface that predates model policies keeps resolving
principals and simply says nothing about models.

`agentOptionsOf(definition, policy)` sends that pair when the domain inherits and the
policy names one; a domain that pins its own model is untouched, and a domain that
inherits where no policy speaks sends no options at all, exactly as before. Because a
policy pair now reaches the runtime of an inheriting domain, the provider must be able
to compose agent options: such a run is refused with `UNSUPPORTED_SUBAGENT_CAPABILITY`
rather than silently dropping the pair.

Covered by `tests/execution.test.ts` (the policy pair is handed to an inheriting
domain, a domain that inherits without a policy still sends no options, a provider
without agent options refuses the run instead of ignoring the policy) and
`tests/qa-principal.test.ts` (the surface carries the optional read, and an older
surface resolves principals while answering nothing about models).
