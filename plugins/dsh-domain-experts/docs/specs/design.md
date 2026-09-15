# dsh-domain-experts

**Status:** Proposed

**Type:** DeepSeek Harness host plugin + client UI

**Primary goal:** configurable domain-specific expert agents with isolated knowledge, memory and resource scopes.

---

## 1. Summary

`dsh-domain-experts` adds a first-class concept of a **Domain Expert** to DeepSeek Harness.

A Domain Expert is not merely a persona prompt. It is a reusable expert profile combining:

- domain persona;
- allowed knowledge sources;
- filesystem/code scope;
- external-service scopes;
- domain-specific memory;
- tool visibility;
- delegation policy;
- model configuration;
- optional access to shared/global context.

The plugin should allow users to define arbitrary domains such as:

```text
Payments
Inventory
Platform
Mobile
Reporting
Customer Support
```

without the implementation knowing anything about those domains.

The central abstraction is:

```text
Domain Expert
    =
Persona
+ Domain Scope
+ Knowledge Scope
+ Memory Namespace
+ Tool Policy
+ Delegation Policy
+ Model Policy
```

The plugin should be configurable primarily through the DSH Web UI while retaining a declarative configuration/storage representation suitable for backup, automation and self-hosted deployments.

---

# 2. Motivation

Large products commonly contain multiple relatively independent functional areas.

A generic development agent may technically have access to all source code, Jira, Wiki, documentation and historical memory, but giving it everything creates several problems:

- irrelevant context contaminates reasoning;
- similar terminology from different product areas gets mixed together;
- memory gradually becomes a global unstructured knowledge dump;
- agents can make assumptions about areas they do not actually understand;
- retrieval becomes less precise;
- prompts and retrieved context become larger;
- ownership boundaries disappear;
- investigation of cross-domain issues becomes difficult to follow.

At the same time, creating completely independent agents for every combination is undesirable:

```text
Payments Jira Agent
Payments Wiki Agent
Payments Git Agent

Inventory Jira Agent
Inventory Wiki Agent
Inventory Git Agent

Platform Jira Agent
Platform Wiki Agent
Platform Git Agent
```

This duplicates functional instructions and becomes difficult to maintain.

Instead the system should separate two dimensions:

```text
WHAT DOES THE AGENT KNOW?
         │
         └── Domain Expert
             Payments / Inventory / Platform / ...

HOW DOES IT GET INFORMATION OR PERFORM WORK?
         │
         ├── Jira worker
         ├── Wiki worker
         ├── Documentation worker
         └── Code/Git worker
```

Domain experts contain **product/domain knowledge**.

Functional workers contain **tool-specific operational knowledge**.

---

# 3. Goals

The plugin should provide a generic mechanism for creating and operating scoped domain experts.

Primary goals:

1. Allow users to create an arbitrary number of Domain Experts.
2. Give each expert an independent persona.
3. Give each expert its own persistent memory namespace.
4. Restrict which knowledge sources the expert can access.
5. Restrict preferred/allowed filesystem and documentation paths.
6. Restrict visible tools.
7. Allow shared read-only/common context.
8. Support expert-to-expert delegation.
9. Support delegation to existing specialized worker agents.
10. Make domain boundaries visible in the UI.
11. Make configuration editable through DSH Web.
12. Keep the implementation independent from any particular product or organization.
13. Make domain scope machine-enforceable where possible rather than relying exclusively on prompt instructions.
14. Preserve a clear audit trail of cross-domain delegation.

---

# 4. Non-goals

The plugin should **not** initially attempt to:

- replace Jira/Wiki/Git-specific agents;
- implement a new generic memory engine;
- implement full operating-system sandboxing;
- provide a security boundary against malicious plugins;
- duplicate the DSH subagent runtime;
- automatically infer organizational ownership from source code;
- automatically grant an expert access to another domain;
- create hundreds of micro-experts automatically;
- modify DSH core.

DSH already supports child-local `persona`, `toolFilter` and delegation depth controls. These should be reused instead of creating another agent execution subsystem.

Important: DSH explicitly does **not** treat `toolFilter` as a full security sandbox. Domain scoping must therefore distinguish between model/tool visibility and actual authorization/enforcement.

---

# 5. Terminology

### Domain

An arbitrary logical area defined by the user.

Examples:

```text
Payments
Inventory
Authentication
Platform
Mobile
```

The plugin must never assume that a domain corresponds to a repository, team, Jira project or Wiki space.

---

### Domain Expert

An agent execution profile associated with exactly one domain.

It contains:

```text
persona
scope
memory
knowledge sources
tool policy
delegation policy
model policy
```

---

### Functional Worker

A specialized agent responsible for performing a type of operation.

Examples:

```text
jira
wiki
documentation
code/git
research
```

Workers should ideally remain domain-agnostic.

The active Domain Scope is passed to them during delegation.

---

### Shared Scope

Resources that several or all domains may read.

Examples:

```text
shared architecture docs
common libraries
engineering conventions
platform contracts
global glossary
```

---

### Foreign Domain

Any domain other than the expert's own domain.

Direct access should normally be denied or discouraged.

Information should instead be requested through the corresponding expert.

---

# 6. Target architecture

High-level architecture:

```text
                         Main Agent
                             │
                      domain_expert
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
     Domain Expert A   Domain Expert B   Domain Expert C
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
                Domain-scoped delegation
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     Jira Worker        Wiki Worker        Code/Git Worker
```

A Domain Expert should not need to contain implementation details for Jira, Wiki or Git.

Instead:

```text
Domain Expert
      ↓
"I need documentation about X"
      ↓
Wiki Worker + DomainScope
      ↓
scoped results
      ↓
Domain Expert
```

---

# 7. Core design principle: scope propagation

The most important architectural concept should be **DomainScope**.

Whenever a domain expert delegates work, the scope travels with the request.

Example conceptual object:

```ts
interface DomainScope {
  domainId: string;

  filesystem?: {
    primary: string[];
    sharedReadOnly: string[];
    denied: string[];
  };

  knowledge?: {
    include: ScopeReference[];
    exclude: ScopeReference[];
  };

  external?: Record<string, unknown>;

  memory?: {
    namespace: string;
    sharedNamespaces?: string[];
  };
}
```

A worker receives:

```ts
{
  (task, domainScope, caller, constraints);
}
```

rather than merely:

```ts
{
  prompt: "Find information about this issue";
}
```

This is what turns Domain Experts from prompt presets into infrastructure.

---

# 8. Domain definition

Recommended persisted representation:

```yaml
id: payments
name: Payments
description: Payment processing and settlement domain

enabled: true

persona:
  instructions: |
    You are the domain expert for Payments.

    Reason from the perspective of this domain.
    Prefer evidence over assumptions.

    Distinguish documented behavior, observed implementation,
    historical decisions and inference.

scope:
  filesystem:
    primary:
      - services/payments/**
      - packages/payment-core/**

    sharedReadOnly:
      - packages/common/**
      - docs/architecture/**

    denied:
      - services/inventory/**

  documentation:
    include:
      - docs/payments/**
      - docs/integrations/payments/**

memory:
  namespace: domain/payments

  sharedReadOnly:
    - shared/product
    - shared/engineering

tools:
  allow:
    - domain_delegate
    - jira_worker
    - wiki_worker
    - docs_worker
    - code_worker

delegation:
  allowCrossDomain: true
  crossDomainMode: expert-only
  maxDepth: 3

model:
  inherit: true
```

No field above should contain product-specific semantics.

---

# 9. Persona composition

A Domain Expert persona should consist of multiple sections rather than one giant user-editable prompt.

Conceptually:

```text
base domain-expert policy
+
user domain description
+
domain-specific instructions
+
scope summary
+
delegation policy
+
retrieved domain memory
+
current task
```

The built-in base policy should establish generic behavior such as:

```text
You are the designated expert for {{domain.name}}.

Prefer evidence from resources belonging to your domain.

Do not infer the internal behavior of another domain when the result
depends on that domain.

When another domain is involved, ask its expert.

Clearly distinguish:

- documented behavior;
- behavior observed in source code;
- historical decisions;
- remembered context;
- your own inference.

If sources conflict, report the conflict.
```

Users can append custom instructions but should not normally need to rewrite this entire policy.

DSH's current subagent runtime supports replacing the deployment persona for an individual child, so this composition can become a child-local persona without changing the global deployment persona.

---

# 10. Expert runtime

The plugin should expose a single generic tool to agents:

```text
domain_expert
```

Conceptual input:

```json
{
  "domain": "payments",
  "task": "Investigate why settlement status is not updated",
  "context": "...",
  "output": "root cause and evidence"
}
```

Optional advanced fields:

```json
{
  "domain": "payments",
  "task": "...",
  "mode": "investigate",
  "background": true
}
```

The model should not supply scope paths or memory namespaces.

Those are resolved exclusively from the persisted Domain Definition.

Flow:

```text
domain_expert(domain="payments")
          ↓
Domain Registry
          ↓
resolve domain profile
          ↓
build persona
          ↓
resolve tool policy
          ↓
resolve memory scope
          ↓
resolve knowledge scope
          ↓
SubagentRuntime.start()
          ↓
Payments expert child
```

Prefer calling the native Subagent Runtime directly rather than generating one statically configured `dsh-tool-subagent` instance per domain.

The native start request supports child-specific persona/tool filtering, whereas the normal `dsh-tool-subagent` package primarily exposes these as plugin configuration.

This allows domains to be added and modified dynamically without mounting another Cordis plugin for each expert.

---

# 11. Tool policy

Each expert should be able to define:

```yaml
tools:
  allow:
    - jira_worker
    - wiki_worker
    - code_worker
    - domain_delegate
```

or:

```yaml
tools:
  deny:
    - deploy
    - production_shell
```

Internally this maps to DSH `toolFilter`.

DSH currently makes filtered global tools disappear from the child's visible tool set and rejects execution lookup for removed tools.

However:

> Tool filtering is capability scoping, not OS-level isolation.

If a permitted generic shell tool can access every path on the machine, a path restriction written only into the persona is not enforceable.

Therefore filesystem/data restrictions need adapters or restricted worker agents.

---

# 12. Resource scope model

Avoid hardcoding:

```text
jiraProjects
confluenceSpaces
githubRepos
```

into the core Domain model.

Instead implement generic **Scope Providers**.

Concept:

```ts
interface DomainScopeProvider {
  id: string;
  title: string;

  validate(config: unknown): void;

  describe(config: unknown): ScopeDescription;

  apply(
    domain: DomainDefinition,
    child: DomainExecutionContext,
  ): Promise<DomainScopeHandle>;
}
```

Possible providers:

```text
filesystem
memory
jira
confluence
wiki
documentation
github
gitlab
knowledge-base
openviking
custom
```

This allows other plugins to extend `dsh-domain-experts`.

For example:

```text
dsh-domain-experts
dsh-domain-experts-jira
dsh-domain-experts-confluence
dsh-domain-experts-openviking
```

or existing plugins can register adapters.

The core should understand neither Jira nor Confluence.

---

# 13. Filesystem scope

Filesystem configuration should distinguish:

```text
Primary
Shared read-only
Denied
```

Example:

```yaml
filesystem:
  primary:
    - services/payments/**
    - docs/payments/**

  sharedReadOnly:
    - packages/common/**
    - docs/architecture/**

  denied:
    - services/inventory/**
    - services/reporting/**
```

Semantics:

### Primary

Resources owned by the domain.

The expert can freely use them according to its tool permissions.

### Shared read-only

Cross-domain resources that are expected to be useful.

Examples:

```text
common libraries
platform code
global architecture
shared schemas
```

### Denied

Areas explicitly outside the domain.

---

# 14. Soft scope vs hard scope

The implementation should explicitly distinguish:

```text
SOFT SCOPE
```

and

```text
ENFORCED SCOPE
```

### Soft scope

Prompt/retrieval preference.

Example:

> Prefer `services/payments/**`.

Useful for ranking but not authorization.

### Enforced scope

The underlying adapter refuses access outside the allowed set.

Example:

```text
code_worker(
  allowedRoots = [
    /repo/services/payments,
    /repo/packages/common
  ]
)
```

UI should clearly show which restrictions are enforceable.

For example:

```text
Filesystem scope
Enforcement: Worker-enforced

Wiki scope
Enforcement: Connector-enforced

Memory namespace
Enforcement: Storage namespace

Persona instruction
Enforcement: Advisory
```

This prevents the plugin from creating a false sense of isolation.

---

# 15. Domain memory

Memory should be isolated by namespace.

Logical model:

```text
memory/
├── shared/
│   ├── product
│   └── engineering
│
└── domains/
    ├── payments
    ├── inventory
    └── platform
```

Expert visibility:

```text
Payments Expert

READ/WRITE:
  domains/payments

READ:
  shared/product
  shared/engineering

NO ACCESS:
  domains/inventory
  domains/platform
```

Recommended conceptual memory tiers:

```text
shared
domain
session/task
```

---

# 16. Memory backend abstraction

Do not tie the plugin to one memory implementation.

Define:

```ts
interface DomainMemoryProvider {
  retrieve(...)
  write(...)
  forget(...)
  listNamespaces(...)
}
```

Possible implementations:

```text
plugin-local storage
OpenViking
another DSH memory plugin
custom knowledge store
```

For the initial implementation, domain metadata and lightweight memory records can use DSH's own non-session storage system.

DSH provides `ctx.storage` and the typed `ctx.storageDomain` layer with JSON and SQLite backends, explicitly intended for durable application data outside session logs.

This makes it preferable to inventing another plugin-specific SQLite connection layer.

---

# 17. Cross-domain collaboration

Domain Experts should not normally read another domain's memory directly.

Instead:

```text
Payments Expert
       ↓
domain_delegate(
  domain="inventory",
  question="What guarantees does event X provide?"
)
       ↓
Inventory Expert
       ↓
structured answer
       ↓
Payments Expert
```

This gives:

- explicit ownership;
- clean context boundaries;
- traceability;
- fewer accidental assumptions;
- easier debugging.

---

# 18. Cross-domain policy

Recommended modes:

```text
disabled
expert-only
direct-read
```

### disabled

Expert cannot access another domain.

### expert-only

Recommended default.

Expert can ask another Domain Expert but cannot directly read foreign domain memory/resources.

### direct-read

Explicitly configured domains/resources may be directly queried.

Useful for tightly coupled product areas.

---

# 19. Expert-to-expert result format

Cross-domain responses should preferably be structured.

Example:

```ts
interface DomainExpertResult {
  summary: string;

  findings: Array<{
    claim: string;
    evidence?: string[];
    confidence?: "high" | "medium" | "low";
  }>;

  conflicts?: string[];

  assumptions?: string[];

  followUps?: string[];
}
```

Structured output makes synthesis by the caller more reliable.

---

# 20. Functional workers

Domain experts should be able to use existing worker/persona agents.

Recommended worker categories:

```text
code
git
jira
wiki
documentation
web/research
```

The core plugin should not implement all of them.

Instead introduce a **Worker Registry**.

Concept:

```ts
interface DomainWorker {
  id: string;

  capabilities: string[];

  execute(request: {
    task: string;
    scope: DomainScope;
    callerDomain: string;
  }): Promise<WorkerResult>;
}
```

Other plugins can register:

```text
worker:jira
worker:wiki
worker:code
worker:docs
```

The Domain Expert sees only workers allowed by its configuration.

---

# 21. Important propagation rule

A worker invoked by a domain expert must never silently lose the scope.

Bad:

```text
Payments Expert
    ↓
Code Agent
    ↓
entire repository
```

Good:

```text
Payments Expert
    ↓

Code Agent
DomainScope:
  primary:
    services/payments
  shared:
    packages/common

    ↓

scoped investigation
```

The DomainScope should behave like execution metadata, not prose copied into arbitrary prompts.

---

# 22. Main DSH integration points

The plugin should run primarily in the **host plane**.

Reason: DSH's current user-settings UI only exposes namespaces registered by live host-plane plugins; plugins mounted solely inside an agent preset cannot register their own settings namespace for this UI.

Recommended integrations:

```text
ctx.tools
ctx.subagent / SubagentRuntime
ctx.settings
ctx.storageDomain
client slots
```

Exact service names should be confirmed against the DSH version during implementation.

DSH's Cordis model allows plugins to consume and provide services through `ctx`, making a dedicated `domainExperts` service appropriate.

Expose:

```ts
ctx.domainExperts;
```

Conceptually:

```ts
interface DomainExpertsService {
  list(): DomainDefinition[]

  get(id: string): DomainDefinition | undefined

  resolveScope(id: string): Promise<ResolvedDomainScope>

  run(
    id: string,
    request: DomainExpertRequest
  ): Promise<DomainExpertResult>

  registerScopeProvider(...): Disposable

  registerWorker(...): Disposable

  registerMemoryProvider(...): Disposable
}
```

---

# 23. Settings and persistent state

Separate:

```text
plugin configuration
```

from:

```text
user-created domain definitions
```

Plugin settings:

```yaml
enabled: true
defaultMaxDepth: 3
defaultCrossDomainMode: expert-only
defaultMemoryProvider: builtin
```

Domain definitions are dynamic records and should live in durable domain storage.

This avoids encoding an arbitrarily large user-managed expert catalog directly into `cordis.yml`.

DSH's storage-domain facility is intended for typed durable plugin/application records and can be routed to JSON or SQLite backends.

---

# 24. DSH Web UI

The plugin should ship a browser-side client entry using `dsh.client`.

DSH currently provides `settings.plugins.tab` for feature-owned pages and `settings.plugin.item` for plugin configuration cards. External plugins can ship their Host and browser halves in the same package without modifying core.

Because Domain Experts are richer than a few scalar settings, use a dedicated:

```text
Settings
└── Plugins
    └── Domain Experts
```

tab rather than trying to cram everything into a small configuration card.

---

# 25. Domain Experts UI

Main screen:

```text
Domain Experts

[ + Add Domain ]

┌──────────────────────────────────────────┐
│ Payments                         Enabled │
│ Payment processing and settlement       │
│                                          │
│ 3 primary paths                          │
│ 2 shared resources                       │
│ 1 memory namespace                       │
│ 4 workers                                │
│                                          │
│ [Edit] [Test Expert] [⋮]                 │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ Inventory                        Enabled │
│ ...                                      │
└──────────────────────────────────────────┘
```

---

# 26. Domain editor

Recommended tabs:

```text
General
Persona
Resources
Memory
Tools
Delegation
Model
Test
```

### General

```text
Name
ID
Description
Enabled
Icon/color
```

Color/icon are UI metadata only.

---

### Persona

Fields:

```text
Base policy     [read-only preview]
Custom instructions
Rendered persona preview
```

Users should be able to see the final composed persona.

---

### Resources

Display registered Scope Providers.

Example:

```text
Filesystem
  Primary paths
  Shared paths
  Denied paths

Documentation
  Sources

Jira
  Projects / filters

Wiki
  Spaces / roots
```

Only providers actually installed should appear.

---

### Memory

```text
Provider: Built-in

Private namespace:
  domain/payments

Shared namespaces:
  shared/product
  shared/engineering

[Inspect memory]
[Clear domain memory]
```

Destructive actions require confirmation.

---

### Tools

Checkbox/multi-select:

```text
☑ Jira worker
☑ Wiki worker
☑ Documentation worker
☑ Code worker
☑ Domain delegation

☐ Production deploy
```

Also show whether the selected subagent provider supports the requested filtering capability.

DSH providers advertise whether `persona`, `toolFilter` and depth limiting are supported; unsupported composition requests fail rather than silently degrading.

---

### Delegation

```text
Cross-domain access:

(o) Ask another expert
( ) Disabled
( ) Allow direct shared access

Allowed target domains:
[x] Any
```

Advanced:

```text
Max delegation depth: 3
Max parallel experts: 3
```

---

### Model

Default:

```text
Inherit from caller
```

Optional:

```text
Provider
Model
Reasoning effort
Max tokens
```

This should reuse DSH's native child agent options where supported instead of implementing model invocation independently.

---

### Test

Allow the user to type:

```text
Explain how order cancellation works.
```

Then display:

```text
Resolved expert:
Payments

Visible tools:
jira_worker
wiki_worker
code_worker

Memory:
domain/payments
shared/product

Filesystem:
PRIMARY services/payments/**
SHARED packages/common/**

Delegation:
expert-only

[Run test]
```

This screen is extremely useful for diagnosing configuration mistakes.

---

# 27. Scope inspector

Add a dedicated **Resolved Scope** preview.

For example:

```text
Resolved Scope — Payments

Resources

✓ services/payments/**
  primary / enforced by code-worker

✓ packages/common/**
  shared / read-only / enforced by code-worker

! docs/architecture/**
  preferred / advisory only

✗ services/inventory/**
  denied

Memory

RW domain/payments
R  shared/product

Cross-domain

Inventory     expert-only
Platform      expert-only
```

The UI must visually distinguish:

```text
enforced
advisory
```

restrictions.

---

# 28. Agent-visible tool design

Initial tool set:

```text
domain_expert
domain_experts_list
```

Potentially combine both into one tool if schema ergonomics are better.

`domain_experts_list` returns lightweight metadata:

```json
[
  {
    "id": "payments",
    "name": "Payments",
    "description": "Payment processing and settlement"
  }
]
```

Do **not** expose full path, memory and security configuration to the model unnecessarily.

---

# 29. Automatic routing

Do not put automatic domain classification in MVP.

MVP:

```text
agent explicitly calls domain_expert(domain=...)
```

Later optional router:

```text
domain_route(task)
```

returns:

```text
Payments: 0.93
Inventory: 0.12
```

Potential policies:

```text
suggest only
auto-route above threshold
multi-domain route
```

Keep routing separate from expert execution.

---

# 30. Interaction with existing personas

Existing specialized personas should remain valid.

Recommended conceptual separation:

```text
PERSONA/WORKER AXIS

Jira
Wiki
Code/Git
Research


DOMAIN AXIS

Payments
Inventory
Platform
Mobile
```

Do not generate:

```text
PaymentsJiraPersona
PaymentsWikiPersona
PaymentsCodePersona
```

The two dimensions should compose at runtime.

---

# 31. Conflict handling

Experts frequently encounter conflicting information.

The base expert policy should require explicit classification:

```text
documented
implemented
remembered
inferred
```

Example result:

```text
Documentation:
Event X is documented as synchronous.

Code:
Current implementation publishes it asynchronously.

Memory:
A previous migration changed this behavior.

Conclusion:
Documentation appears stale.
```

Never silently merge conflicting evidence.

---

# 32. Failure handling

### Domain not found

Return explicit error:

```text
DOMAIN_NOT_FOUND
```

Include available domain IDs.

---

### Disabled domain

```text
DOMAIN_DISABLED
```

---

### Unsupported provider feature

If selected Subagent Provider cannot support required persona/tool filter/depth behavior:

```text
UNSUPPORTED_SUBAGENT_CAPABILITY
```

Do not silently weaken the policy.

This follows DSH's own capability-gated subagent design.

---

### Missing scope provider

Example:

```text
Domain "payments" requires scope provider "jira",
but no provider with id "jira" is registered.
```

The Domain Editor should display the domain as degraded.

---

### Worker unavailable

Expert should receive:

```text
worker_unavailable
```

and continue with available evidence when appropriate.

---

# 33. Auditability

Record important expert execution metadata:

```text
domain
caller
target domain
worker used
scope provider
delegation path
duration
result status
```

Do not record secrets or full retrieved content unless explicitly configured.

Useful future telemetry:

```text
runs by domain
cross-domain delegations
worker usage
token usage
latency
failed scope checks
```

---

# 34. Suggested repository structure

```text
dsh-domain-experts/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
│
├── src/
│   ├── index.ts
│   │
│   ├── service/
│   │   ├── DomainExpertsService.ts
│   │   ├── DomainRegistry.ts
│   │   └── execution.ts
│   │
│   ├── domain/
│   │   ├── types.ts
│   │   ├── schema.ts
│   │   ├── resolver.ts
│   │   └── persona.ts
│   │
│   ├── scopes/
│   │   ├── registry.ts
│   │   ├── types.ts
│   │   └── filesystem.ts
│   │
│   ├── workers/
│   │   ├── registry.ts
│   │   └── types.ts
│   │
│   ├── memory/
│   │   ├── registry.ts
│   │   ├── builtin.ts
│   │   └── types.ts
│   │
│   ├── tools/
│   │   ├── domain-expert.ts
│   │   └── list-domains.ts
│   │
│   ├── storage/
│   │   ├── domain-spec.ts
│   │   └── repository.ts
│   │
│   └── client/
│       ├── index.ts
│       ├── DomainExpertsPage.tsx
│       ├── DomainList.tsx
│       ├── DomainEditor.tsx
│       ├── ScopeEditor.tsx
│       ├── ScopeInspector.tsx
│       ├── PersonaEditor.tsx
│       └── ExpertTestPanel.tsx
│
└── test/
    ├── domain-resolution.test.ts
    ├── scope-propagation.test.ts
    ├── persona.test.ts
    ├── delegation.test.ts
    ├── storage.test.ts
    └── ui/
```

---

# 35. Public extension API

Other plugins should be able to extend Domain Experts without importing internals.

Conceptual API:

```ts
ctx.domainExperts.registerScopeProvider({
  id: 'jira',
  ...
})

ctx.domainExperts.registerWorker({
  id: 'jira',
  ...
})

ctx.domainExperts.registerMemoryProvider({
  id: 'openviking',
  ...
})
```

This is important for keeping the core generic.

A future Jira integration can live independently:

```text
dsh-domain-experts-jira
```

and contribute its own UI editor + runtime scope adapter.

---

# 36. Example third-party configuration

The plugin README should use neutral examples.

Good:

```text
Payments
Inventory
Platform
Mobile
```

Avoid using organization-specific names in documentation, schemas, screenshots or tests.

Tests should use generic fixtures such as:

```text
alpha
beta
payments
inventory
platform
```

---

# 37. MVP

The first usable version should intentionally remain small.

## MVP scope

Implement:

```text
Domain CRUD
Domain persona
Domain description
filesystem scope metadata
private memory namespace
shared memory namespaces
tool filtering
domain_expert tool
cross-domain expert delegation
native subagent execution
Settings → Plugins → Domain Experts UI
resolved-scope inspector
```

Initial scope providers:

```text
filesystem
builtin memory
```

Worker integrations can initially be generic tool references.

Do not block MVP on Jira/Confluence integrations.

---

# 38. Phase 2

Add:

```text
Worker Registry
Scope Provider extension API
Jira adapter
Wiki/Confluence adapter
documentation/knowledge adapter
model overrides
structured expert output
execution audit log
```

---

# 39. Phase 3

Add:

```text
automatic domain routing
domain relationships
scope inheritance
domain templates
domain import/export
expert quality metrics
cross-domain review
domain-aware retrieval ranking
OpenViking/memory adapters
```

---

# 40. Optional domain hierarchy

Do not implement initially, but leave the model compatible with:

```text
Commerce
├── Payments
├── Orders
└── Inventory
```

Potential future field:

```yaml
parent: commerce
```

Inheritance could provide:

```text
shared docs
common memory
tool policy
workers
```

while children retain their own private memory.

---

# 41. Testing strategy

Unit-test:

```text
domain configuration validation
persona composition
scope resolution
memory namespace resolution
tool-filter generation
cross-domain policy
delegation depth
missing adapters
disabled domains
```

Integration-test:

```text
Main agent → Domain A
Domain A → worker
Domain A → Domain B
Domain B → worker

and ensure Domain B resources never leak into Domain A directly.
```

Security/policy tests should explicitly try:

```text
../foreign-domain
symlink/path escapes
unknown worker
foreign memory namespace
foreign domain direct access
tool denied by filter
delegation beyond max depth
```

UI tests:

```text
create domain
edit domain
disable domain
delete domain
scope provider missing
preview resolved scope
test expert
concurrent settings modification
```

---

# 42. Compatibility strategy

Avoid:

```text
patching DSH frontend bundle
patching installed DSH packages
private imports from DSH internals
```

Prefer:

```text
Cordis services
official subagent runtime
official tool registration
ctx.storageDomain
ctx.settings
dsh.client
settings.plugins.tab
```

DSH currently documents external settings cards and plugin-owned tabs as supported extension seams, so UI integration should use those rather than modifying core Web files.

---

# 43. Important architectural decisions

## Decision 1 — Domain Expert is not merely a persona

The persona is only one property.

The real object is:

```text
Expert = Persona + Scope + Memory + Policy
```

---

## Decision 2 — Separate domains from workers

Do not create one functional agent per domain.

Compose:

```text
Domain Expert × Worker
```

at runtime.

---

## Decision 3 — DomainScope is first-class data

Scope must travel through delegation programmatically.

Do not rely solely on:

```text
"please only look in this folder"
```

inside prompts.

---

## Decision 4 — Foreign domains go through experts

Recommended default:

```text
crossDomainMode = expert-only
```

This keeps domain ownership explicit.

---

## Decision 5 — Shared resources are explicit

Do not solve dependencies by granting every expert the entire repository.

Use:

```text
primary
shared
foreign
```

resource classes.

---

## Decision 6 — UI and backend remain separate

Domain runtime must work without DSH Web.

UI is a client of:

```text
DomainExpertsService
```

rather than the owner of business logic.

This keeps CLI/config/API usage possible later.

---

## Decision 7 — Host-plane plugin

The core plugin should live at the host level so that domains can be dynamically managed and exposed through the current DSH settings infrastructure.

Do not make every Domain Expert a separate installed Cordis plugin or agent preset.

---

# 44. Definition of Done for v1

`dsh-domain-experts` v1 can be considered usable when a user can:

1. Install one plugin.
2. Open `Settings → Plugins → Domain Experts`.
3. Create several arbitrary domains.
4. Give each domain custom instructions.
5. Configure primary/shared filesystem areas.
6. Configure isolated memory namespaces.
7. Choose the tools/workers available to the expert.
8. Configure cross-domain delegation.
9. Invoke:

   ```text
   domain_expert(domain="payments", task="...")
   ```

10. Have DSH spawn a child agent with the correct persona and tool policy.
11. Have that child receive only the appropriate domain context.
12. Delegate a foreign-domain question to another expert.
13. Inspect the resolved scope in UI.
14. See whether every restriction is enforced or merely advisory.
15. Restart DSH without losing configured domains.

---

# 45. Recommended implementation order

### Step 1

Implement the pure domain model:

```text
DomainDefinition
DomainScope
DomainExpertRequest
DomainExpertResult
```

No DSH runtime dependency beyond schemas.

### Step 2

Implement persistent `DomainRegistry` using DSH `storageDomain`.

### Step 3

Expose `ctx.domainExperts`.

### Step 4

Implement persona composition.

### Step 5

Implement `domain_expert` on top of native Subagent Runtime.

### Step 6

Map domain tool policy to native child `toolFilter`.

### Step 7

Implement built-in memory namespaces.

### Step 8

Implement filesystem Scope Provider.

### Step 9

Implement cross-domain `domain_delegate`.

### Step 10

Add the browser half and Domain CRUD UI.

### Step 11

Add Resolved Scope inspector.

### Step 12

Add Expert Test screen.

### Step 13

Formalize Scope Provider / Worker / Memory Provider extension APIs.

### Step 14

Only after the core is stable, implement external integrations such as Jira, Wiki/Confluence or OpenViking.

---

# 46. Longer-term vision

The useful abstraction is bigger than a collection of expert prompts.

Eventually Domain Experts can become DSH's domain-context routing layer:

```text
                       Task
                         │
                    Domain Router
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Domain A    Domain B    Domain C
             │           │           │
             └───────────┼───────────┘
                         │
                     Workers
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
       Code             Jira             Wiki
```

Every execution then answers two independent questions:

```text
Which domain owns the knowledge?
```

and:

```text
Which capability should perform the work?
```

That separation should remain the core design principle of `dsh-domain-experts`.
