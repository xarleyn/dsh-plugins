# Architecture

Module map for `@yadsh/dsh-domain-experts`. The product contract is
[../SPEC.md](../SPEC.md); this file is about how the pieces fit.

## Two halves, one package

```text
src/
├── index.ts            host entry: Config, DomainExpertsService, Typert Remote,
│                       settings namespace, tool registration, extension APIs
├── config.ts           Schemastery Config + resolveConfig
├── types.ts            the domain model, shared verbatim with the browser
├── host/
│   ├── errors.ts       DomainExpertsError + stable codes
│   ├── schema.ts       zod record schema, semantic validation, normalization
│   ├── storage.ts      storageDomain spec (domains + memory tables)
│   ├── registry.ts     DomainRegistry: CRUD over the domains table
│   ├── persona.ts      base policy + composed persona (template-safe)
│   ├── resolver.ts     definition → resolved profile (scope, tools, memory, persona)
│   ├── policy.ts       cross-domain verdict + parallel budget (pure)
│   ├── execution.ts    ctx.subagents orchestration, run tracker, audit emit
│   ├── audit.ts        bounded audit ring
│   ├── result.ts       structured-answer parser
│   ├── scopes/         provider registry, filesystem provider, path guard
│   ├── memory/         provider registry, built-in namespace-partitioned store
│   ├── workers/        worker registry (scope-enforcement claims)
│   └── tools/          the three agent-visible tools
└── client/
    ├── index.tsx       apply(): mount Remote, register the settings tab
    ├── remote.ts       hand-written face of the generated Remote contract
    ├── session-id.ts   reads the current session without widening the host face
    ├── DomainExpertsPage.tsx  container: state, Remote calls, orchestration
    ├── DomainEditor.tsx       presentational editor (8 tabs)
    ├── ScopeInspector.tsx     enforcement-labelled resolved scope
    ├── components.tsx         small design-token controls
    └── styles.ts              the page stylesheet
```

`src/types.ts` is imported by both halves and imports nothing platform-specific.
The host never imports `src/client/**`; the client never imports the plugin
logger. `scripts/verify-package.mjs` asserts both.

## Why the layers are separate

**`resolver.ts` is the single source of truth for what an expert gets.** It
builds the profile the child runs with *and* the profile the inspector renders,
so the run path and the UI cannot drift apart. It has no dependency on
`ctx.subagents`: the runtime call lives in `execution.ts`, one layer up.

**`policy.ts` and `scopes/path-guard.ts` are pure.** Cross-domain decisions and
path containment are the two places where a mistake means a policy hole, so
both are testable without a host context, and the same function is used by the
tool layer, the inspector and the tests.

**`execution.ts` talks to a structural `SubagentsFace`, not to
`ctx.subagents`.** The real runtime satisfies it in `index.ts`; a test satisfies
it with a recorder. That keeps the orchestration — capability gating, depth,
run tracking, audit, parsing — under unit test without a harness.

**`client/DomainExpertsPage.tsx` holds the draft, not the policy.** It calls the
Remote methods and renders whatever comes back, including refusals and
degradations. Moving a rule into the browser would make a CLI unable to reuse
the same behaviour.

## Data flow of one run

```text
domain_expert(domain, task, context, output, mode, background)
        │
        ├─ requireDefinition          DOMAIN_NOT_FOUND / DOMAIN_DISABLED / STORAGE_UNAVAILABLE
        ├─ activeRun(callerSession)   decides whether this is a delegation
        │      └─ delegationVerdict   DELEGATION_DENIED
        ├─ parallelBudget             PARALLELISM_EXCEEDED
        ▼
   runExpert
        ├─ depth check                DELEGATION_DEPTH_EXCEEDED
        ├─ resolveExpert
        │     ├─ workers.selectedFor → enforcedProviders
        │     ├─ scope providers     → resources (enforcement-labelled), external scope
        │     ├─ memoryEntries       → read/write + read-only namespaces
        │     ├─ toolEntries         → tool mask (aliases resolved, denials applied)
        │     ├─ delegationSummary   → peers + degradations
        │     └─ composePersona      → template-safe persona with recalled notes
        ├─ provider capability gate   UNSUPPORTED_SUBAGENT_CAPABILITY
        ├─ ctx.subagents.start        → child session
        │     (background: startContinuable → receipt)
        ├─ await result → parseExpertAnswer
        ├─ AuditRing.record + plugin log
        └─ dispose + tracker release
```

## Enforcement, precisely

| Mechanism | Where | Strength |
| --- | --- | --- |
| Tool mask | `resolver.toolFilter` → `SubagentStartRequest.toolFilter` | Harness-enforced: hidden *and* non-executable |
| Depth cap | `delegation.maxDepth` → `SubagentStartRequest.maxDepth` | Harness-enforced |
| Memory partitions | `memoryEntries` + `memoryKeyOf` | Plugin-enforced at the storage-key level |
| Cross-domain policy | `policy.delegationVerdictOf` | Plugin-enforced before any run starts |
| Parallel budget | `policy.parallelBudgetOf` + `RunTracker` | Plugin-enforced per caller session |
| Filesystem paths | `decidePath` / `resolveWithinRoot` | Enforced only by a worker that consumes the scope; `advisory` otherwise |
| Persona wording | `composePersona` | Advisory by construction, and labelled as such |

## Known trade-offs

- **`domain_delegate` is an alias, not a second tool.** One entry point means the
  cross-domain policy cannot be bypassed by reaching for another tool name; the
  alias keeps design-vocabulary configurations from being reported as degraded.
  Only real registered names reach the runtime's tool filter, which rejects
  unknown names loudly.
- **Expert-only tools are globally registered.** `domain_delegate`'s sibling
  concern — a top-level agent seeing `domain_memory` — is handled by refusing
  with `EXPERT_NOT_CALLER`, because the runtime offers no seam to register a
  tool inside a child's creation window.
- **The run tracker is process-local.** A continuable child resumed after a
  restart cannot be attributed to a domain, so delegation from it fails loudly
  instead of guessing.
- **`resolveWithinRoot` follows symlinks on the nearest existing ancestor.** A
  path that does not exist yet is still checked lexically and against the real
  root, so a symlinked intermediate directory cannot smuggle a target out.
