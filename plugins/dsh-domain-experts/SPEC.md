# dsh-domain-experts — product contract

**Status:** implemented (v1 as scoped by §4)
**Type:** Host plugin + browser client (`@yadsh/dsh-domain-experts`)
**Companion documents:** [README.md](./README.md) (operation),
[docs/architecture.md](./docs/architecture.md) (modules),
[docs/superpowers/specs/2026-09-13-domain-experts-design.md](./docs/superpowers/specs/2026-09-13-domain-experts-design.md)
(the originating design note).

This file is the normative contract. When behaviour and this file disagree, the
file is the bug report.

---

## 1. Product contract

Each numbered item is a verifiable guarantee, phrased as behaviour.

1. A user can create at least 100 domains without any plugin configuration
   change; each is an independent record with its own persona, scope, memory
   namespace, tool policy, delegation policy and model policy.
2. Creating, updating, disabling and deleting a domain through the UI or
   `ctx.domainExperts` never requires a DSH restart, and a restart never loses a
   configured domain.
3. Domain records survive an update unchanged in every field the user did not
   edit: `createdAt` is preserved and `updatedAt` is advanced.
4. A domain id is assigned on create and cannot be changed afterwards. An
   update that carries a different id updates a different record or fails with
   `DOMAIN_NOT_FOUND`; it never renames in place.
5. An invalid definition is refused before it is persisted. Structural problems
   fail with `DOMAIN_INVALID`; semantic problems (bad id, empty name, malformed
   namespace, absolute or traversing path, a tool both allowed and denied, a
   non-integer depth cap) are reported field by field.
6. Custom persona instructions are **appended** to the built-in base policy and
   can never replace it. The composed persona is viewable before a run.
7. Instructions containing `{{` are refused, because the composed persona is
   handed to the subagent runtime as a template and would be interpolated
   against deployment variables.
8. Recalling memory into a persona is skippable: an unavailable memory backend
   degrades the run but never fails it.
9. An expert child is an ordinary DSH subagent of the calling agent. It appears
   in the session tree, inherits the caller's workspace, and its recursion
   budget is the one the runtime enforces.
10. The plugin never re-implements agent execution: it composes a
    `SubagentStartRequest` (`persona`, `toolFilter`, `maxDepth`, optional
    `agentOptions`) and calls `ctx.subagents.start`.
11. A provider that cannot supply a required capability is refused **before** a
    run starts, with `UNSUPPORTED_SUBAGENT_CAPABILITY`. The plugin never
    silently drops a policy because the provider could not apply it.
12. The tool policy reaches the child as a real tool mask: a filtered tool
    disappears from the child's view and refuses to execute. The plugin's own
    tools are always in the mask unless the domain denies them.
13. A configuration naming a tool that is not registered in the deployment
    fails with `WORKER_UNAVAILABLE`, naming the offending tool.
14. Memory is partitioned by namespace. An expert may read and write its own
    namespace, read its shared namespaces, and nothing else. A foreign
    namespace is refused with `MEMORY_SCOPE_DENIED`, and a write to a read-only
    namespace is refused with the same code. The model never supplies a
    namespace that is trusted.
15. A foreign domain is reached through its own expert. With the default
    `expert-only` mode an expert cannot read another domain's memory or
    resources directly.
16. Cross-domain policy is machine-enforced: `disabled` refuses every
    delegation, an explicit target list restricts which domains are reachable,
    and self-delegation is refused even when everything else allows it.
17. Delegation depth is capped by `delegation.maxDepth`, checked by the plugin
    before the call (`DELEGATION_DEPTH_EXCEEDED`) and again by the runtime.
18. Parallel expert runs per calling session are capped: the caller's own
    `maxParallel` when the caller is an expert, otherwise the plugin default.
    Exceeding it refuses the call with `PARALLELISM_EXCEEDED`.
19. A disabled or unknown domain is refused with `DOMAIN_DISABLED` or
    `DOMAIN_NOT_FOUND`; the not-found message lists the known domain ids, and a
    disabled domain is absent from `domain_experts_list`.
20. Every restriction the UI shows is labelled `enforced` or `advisory`. A
    filesystem entry is `enforced` only when a selected worker declares that it
    applies that scope; otherwise it is `advisory`, including in the composed
    persona ("preference only").
21. Degraded configuration is surfaced, not hidden: a configured but
    unregistered scope provider, a missing memory provider, a worker without a
    tool binding, an unverifiable tool name and a missing delegation target each
    appear as a named degradation with the references that caused it.
22. Each run records one audit entry — domain, caller domain, caller session,
    child session, mode, status, duration, delegation path and degradation
    codes — mirrored to the plugin log. No task text, retrieved memory or
    credential is recorded.
23. The plugin never throws from load. A storage failure is reported as
    `STORAGE_UNAVAILABLE` with the underlying message, and the plugin keeps
    serving its tools and UI.
24. A corrupt domain record fails the storage open loudly, naming the table and
    key. The plugin then serves no domains rather than silently dropping the
    user's data.
25. The management UI is a client of `ctx.domainExperts`. It holds no policy and
    performs no enforcement; the same service can back a CLI or an API.
26. The browser half degrades rather than throws: an unavailable slot, an
    unavailable settings namespace or an unanswered Remote call renders as a
    labelled status, never as a broken page.
27. The plugin registers **no** settings card. Its UI is one page in
    `settings.plugins.tab`, so the bundle carries no card shell.
28. Every agent-visible tool declares `output { schema, render }`, and a refusal
    carries its stable error code in the message the model receives.

## 2. Data model

One storage unit, `domain_experts` (the unit-name grammar is
`^[a-z][a-z0-9_]*$`), with two tables:

| Table | Key | Value |
| --- | --- | --- |
| `domains` | domain id | `DomainDefinition` |
| `memory` | `<namespace>::<key>` | `MemoryRecord` |

- **Unit version** is `1` and moves together with `DOMAIN_RECORD_VERSION`.
  A breaking record change bumps both and lists the previous version in
  `compatibleVersions`.
- **Record schemas are zod**, not Schemastery: that is the storage-domain
  contract. The plugin's own `Config` is Schemastery, as the plugin contract
  requires.
- **Invalid records are not skipped.** A record that fails its schema aborts the
  open with a `DomainError` naming the table and key, and the plugin reports
  `STORAGE_UNAVAILABLE`. Silently dropping a user's domain would be worse than
  refusing to start.
- **No optional properties.** Every field has an explicit zero-value (`''`, `0`,
  `false`, `[]`). This keeps the persisted format, the Typert wire contract and
  the record schema free of the absent-versus-`undefined` distinction, which the
  generated Remote client cannot represent. Absent means "not configured",
  never "unknown".
- **Provider config is opaque.** `scope.providers` maps a provider id to a
  JSON-encoded document; the core never interprets a value, and the owning
  provider validates it. This is what keeps the core free of Jira, Wiki, Git and
  OpenViking semantics.
- **Writes are canonical.** Every persisted record passes through
  `normalizeDomainDefinition`, which trims and deduplicates paths, namespaces and
  tool names. Normalization is idempotent.

### Error codes

`DOMAIN_NOT_FOUND`, `DOMAIN_DISABLED`, `DOMAIN_INVALID`, `DOMAIN_EXISTS`,
`UNSUPPORTED_SUBAGENT_CAPABILITY`, `SUBAGENT_PROVIDER_MISSING`,
`SCOPE_PROVIDER_MISSING`, `MEMORY_PROVIDER_MISSING`, `MEMORY_SCOPE_DENIED`,
`WORKER_UNAVAILABLE`, `DELEGATION_DENIED`, `DELEGATION_DEPTH_EXCEEDED`,
`PARALLELISM_EXCEEDED`, `EXPERT_NOT_CALLER`, `TASK_REJECTED`,
`STORAGE_UNAVAILABLE`.

Degradation codes (UI and audit): `SCOPE_PROVIDER_MISSING`,
`MEMORY_PROVIDER_MISSING`, `WORKER_UNAVAILABLE`, `TOOL_UNVERIFIED`,
`DELEGATION_TARGET_MISSING`.

## 3. Lifecycle

```text
plugin load
  │  constructor: config, logger, built-in scope provider, tool objects
  │  applyEnabled(): register the agent tools when enabled
  │  ctx.inject(['settings']): publish the settings namespace (optional seam)
  ▼
first domain operation
  │  storageDomain.open(domain_experts)        ── failure ⇒ STORAGE_UNAVAILABLE
  │  DomainRegistry + builtin memory provider
  ▼
                ┌──────────────────────────────────────────┐
                │            domain record                 │
                └──────────────────────────────────────────┘
   create ──▶ validate ──▶ normalize ──▶ put      (DOMAIN_EXISTS / DOMAIN_INVALID)
   update ──▶ require ──▶ validate ──▶ put        (DOMAIN_NOT_FOUND, createdAt kept)
   enable ──▶ require ──▶ put                     (no-op when already in state)
   delete ──▶ delete                              (memory records are kept)

expert run
  │  domain_expert(domain, task, …)
  │  requireEnabled → depth check → parallel check → delegation policy (expert callers)
  │  resolveExpert: providers → resources → memory → tools → delegation → persona
  │  capability gate on the provider
  │  ctx.subagents.start → child session
  │  await result → parse → audit → dispose → tracker release
  ▼
  DomainExpertResult { status, summary, findings, conflicts, assumptions, followUps }
```

Statuses: `completed`, `aborted`, `error`, `max-tokens`, `refusal`,
`delegated` (a background run that returns a receipt), `preview`.

## 4. Scope: Included / Deferred

**Included in v1**

Domain CRUD; composed persona with preview; filesystem scope metadata with a
real path-containment primitive; private and shared memory namespaces with a
built-in durable backend; tool policy mapped to the native tool mask;
`domain_expert`, `domain_experts_list` and `domain_memory`; cross-domain
delegation through the owning expert with a machine-enforced policy;
execution on the native subagent runtime; the Domain Experts settings tab with
a resolved-scope inspector and an expert test screen; the scope-provider,
memory-provider and worker registries as public extension APIs; an in-memory
audit ring mirrored to the plugin log.

**Deferred, with reasons**

| Deferred | Why, and what v1 does instead |
| --- | --- |
| Durable execution audit storage | The audit ring plus the plugin log satisfy "clear audit trail of cross-domain delegation" without a third table. A queryable store is a separate concern. |
| Native `outputSchema` on the child | The structured-answer contract is prompt-driven with a lenient parser, so a mistyped fence degrades to prose instead of failing a run. |
| Jira / Wiki / Confluence / OpenViking adapters | The core stays product-agnostic; they register through `registerScopeProvider` / `registerMemoryProvider` / `registerWorker`. |
| Per-provider typed configuration UI | `scope.providers` is an opaque JSON map validated by its owner; a provider-owned editor is a UI seam of its own. |
| Automatic domain routing (`domain_route`) | Deliberately out of v1: routing stays separate from expert execution. |
| Domain hierarchy (`parent`) | The record keeps a flat id space, which a future `parent` field can extend without a breaking change. |
| Continuable-child delegation after a restart | A resumed durable child is no longer attributable to a domain, so delegation from it fails with `EXPERT_NOT_CALLER` rather than guessing. |
| Enforcing an arbitrary global shell tool | A path restriction is only enforced by a worker that consumes the scope; the UI says `advisory` when none does. |

## 5. Required end-to-end scenarios

1. **Create and use.** Open `Settings → Plugins → Domain Experts`, create
   `payments` with a persona and one primary path. In a chat, call
   `domain_expert(domain: "payments", task: "…")`. Expect a child session whose
   persona contains the base policy, the task and the primary path.
2. **Scope inspection.** Open the same domain. Expect the resources table to
   list each path with `advisory` (no worker selected) and, after selecting an
   enforcing worker, `enforced` naming that worker.
3. **Memory isolation.** Record a note with `domain_memory(action: "write")`
   inside the expert. Then call `domain_memory(action: "read", namespace:
   "domain/other")` from the same expert. Expect `MEMORY_SCOPE_DENIED`.
4. **Cross-domain question.** With `payments` in `expert-only` mode, call
   `domain_expert(domain: "inventory", task: "…")` from inside the payments
   expert. Expect an inventory child whose audit entry has delegation path
   `payments > inventory`.
5. **Cross-domain refusal.** Set `payments` to `disabled`. Repeat step 4. Expect
   `DELEGATION_DENIED` and no child session.
6. **Disabled domain.** Disable `inventory`. Expect `domain_experts_list` to omit
   it and `domain_expert(domain: "inventory")` to fail with `DOMAIN_DISABLED`.
7. **Degraded domain.** Add `jira` to `scope.providers`. Expect the inspector to
   list `SCOPE_PROVIDER_MISSING` with the provider id, and the domain to keep
   working.
8. **Bad tool name.** Put an unregistered tool in `tools.allow`. Expect
   `WORKER_UNAVAILABLE` naming the tool, and no child session.
9. **Restart.** Restart DSH. Expect every domain, its memory records and its
   settings to be intact.
10. **Corrupt record.** Write an invalid record into the storage unit. Expect a
    loud `STORAGE_UNAVAILABLE` naming the table and key, and no silent loss.

## 6. Implementation status

| Area | Status | Notes |
| --- | --- | --- |
| Domain model, validation, normalization | Implemented | `src/types.ts`, `src/host/schema.ts` |
| Durable domain CRUD | Implemented | `src/host/registry.ts`, `src/host/storage.ts` |
| Persona composition | Implemented | Base policy + sections; `{{` guard |
| Scope-provider registry | Implemented | Built-in `filesystem`; extension API on the service |
| Filesystem scope metadata + path containment | Implemented | `path-guard.ts`, `resolveWithinRoot` |
| Memory provider registry + built-in backend | Implemented | Namespace-partitioned records |
| Worker registry | Implemented | MVP workers are generic tool references |
| `domain_expert` on the native subagent runtime | Implemented | Persona, tool mask, depth cap, model options |
| Cross-domain delegation | Implemented | Same tool, policy-enforced; `domain_delegate` alias |
| Tool policy → native tool mask | Implemented | Verified against the runtime's own refusal |
| Background expert runs | Implemented | Continuable children; returns a receipt |
| Structured expert output | Partial | Prompt contract with lenient parsing; native `outputSchema` deferred |
| Execution audit | Partial | In-memory ring + plugin log; durable store deferred |
| Settings tab UI | Implemented | `settings.plugins.tab`, id `domain-experts` |
| Resolved-scope inspector | Implemented | Per-entry enforcement labels |
| Expert test screen | Implemented | Real run through `ctx.agents`; profile preview |
| Extension APIs | Implemented | `registerScopeProvider` / `registerMemoryProvider` / `registerWorker` |
| Jira / Wiki / OpenViking adapters | Deferred | Out of v1 by design |
| Automatic routing | Deferred | Out of v1 by design |
