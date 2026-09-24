# Domain Experts

Give a part of your product its own expert agent: one persona, one scope, one
memory namespace, one tool policy — configured in the DSH Web UI and executed
as an ordinary DeepSeek Harness subagent.

```text
Main agent
    │  domain_expert(domain="payments", task="…")
    ▼
Payments expert  ── domain_expert(domain="inventory", …) ──▶  Inventory expert
    │
    └── scoped tools, scoped memory, scoped paths
```

A domain expert is not a prompt preset. It is a persisted record that binds
together a persona, a filesystem and knowledge scope, a memory namespace, a
tool policy, a delegation policy and a model policy — and the plugin tells you,
per restriction, whether it is **enforced** by code or merely **advisory**.

## Features

- **Arbitrary domains.** Create as many as you like — `payments`, `inventory`,
  `platform`, anything. The plugin knows nothing about your product areas.
- **Composed persona.** A fixed base policy plus your instructions; the base
  policy (evidence classes, conflict reporting, no foreign-domain guessing)
  cannot be replaced by accident.
- **Scoped memory.** Each expert has a private read/write namespace and
  read-only shared namespaces. The private boundary is a storage key layout,
  not a sentence in a prompt.
- **Scoped tools.** The selected tools are the only ones the expert can see or
  execute; a tool that is filtered out refuses to run.
- **Honest enforcement.** Every filesystem rule, memory namespace and
  delegation target is labelled `enforced` or `advisory`, and a path
  restriction is only called enforced when a selected worker actually applies
  it.
- **Cross-domain delegation.** Foreign domains are reached through their own
  expert (`expert-only` by default), with an explicit mode, target list and
  depth cap; the delegation chain is visible in the audit ring.
- **Extension seams.** Other plugins register scope providers, memory backends
  and workers through `ctx.domainExperts` without importing plugin internals.
- **Diagnostics.** A resolved-scope inspector and an expert test screen show
  exactly what the child will receive, including degraded configuration.

## Install

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-domain-experts
```

Then open `Settings → Plugins → Domain Experts`.

## Managing domains

The tab lists every domain with its scope counts and degradations. `Edit` — or
the card itself — opens one in the same pane: identity and status, persona,
filesystem and knowledge scope, memory namespaces, tool policy, cross-domain
delegation, model route, the test screen and the run history. The history lists
every execution of the domain whichever surface started it — a conversation,
the agents panel or the test screen — with the caller session, the delegation
path and the outcome. It is read from the host's bounded in-memory audit ring
(mirrored to the plugin log), so it covers the running process. `All domains`
goes back to the list,
asking first when the form holds unsaved edits, and `Save` writes the record in
place. Every domain is an ordinary record in the plugin's storage, no matter who
created it: there is no built-in expert the UI refuses to change.

## Tools

The plugin registers three agent-facing tools.

| Tool | Purpose |
| --- | --- |
| `domain_expert` | Ask one domain's expert to investigate, answer or review something. Called from inside an expert it is a delegation, and the caller's cross-domain policy decides whether it is allowed. |
| `domain_experts_list` | Identifiers, names and one-line descriptions of the enabled domains. Scope, memory and policy stay out of the model's view. |
| `domain_memory` | Read and write the calling expert's own memory. Only namespaces resolved from the persisted definition are reachable, and only the private one accepts writes. |

`domain_delegate` is accepted as a tool-policy alias for `domain_expert` so a
configuration written against the design vocabulary is not reported as
degraded.

## Configuration

Plugin settings live in the `domain-experts` namespace and are edited in
`Settings → Plugins → Configurable` (or `Settings → Plugins → Domain Experts`
for the domains themselves). Changes apply to subsequent operations.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Register the agent-facing tools and serve the management UI. |
| `subagentProvider` | string | `spawn` | `ctx.subagents` provider used to spawn expert children. |
| `defaultMaxDepth` | number | `3` | Delegation depth cap pre-filled on new domains. |
| `defaultMaxParallel` | number | `3` | Parallel experts allowed per calling session when the caller is not itself an expert. |
| `defaultCrossDomainMode` | string | `expert-only` | Cross-domain mode pre-filled on new domains: `disabled`, `expert-only` or `direct-read`. |
| `defaultMemoryProvider` | string | `builtin` | Memory provider id every expert uses. Providers are registered when the plugin loads, so naming one the deployment did not start with takes a restart. |
| `memoryDbPath` | string | `<DSH_HOME>/domain-experts-memory.db` | Database file the `sqlite` memory provider owns. |
| `recallLimit` | number | `5` | Memory records recalled into an expert's persona. |
| `auditLimit` | number | `200` | Execution audit entries kept in memory and mirrored to the log. |

### Where memory lives

Two carriers ship with the plugin, and a deployment selects one:

| `defaultMemoryProvider` | Records live in | Cost of a write |
| --- | --- | --- |
| `builtin` | the `memory` table of the plugin's storage unit — the storage backend holds the whole unit in memory and rewrites it on every change | the size of everything stored |
| `sqlite` | one database file of the plugin's own (`memoryDbPath`), one row per record | one row |

Switching to `sqlite` imports what the unit already holds, once, before the
plugin serves anything: the copy runs in a single transaction and is checked
record by record — text, tags, both timestamps — and a record that does not
survive the copy fails the open loudly (`STORAGE_UNAVAILABLE`, naming what
disagreed) instead of leaving an expert reading a half-filled database. The unit
keeps its records afterwards: that copy is how a deployment goes back, and it is
retired only by the operator, never by the plugin.

Ranking does not move with the carrier. Both providers score a record by how
many query terms appear in its key, text and tags, order by that score and then
by the newest update, and break a tie by namespace and key — so an expert that
recalled three notes before a switch recalls the same three, in the same order.
`memory-parity.test.ts` holds the two providers to that promise over a fixed
query set, and it is the check to repeat on a stand before switching it.

For a deployment that manages its own data: the database needs the same treatment
as the plugin's other SQLite stores — its `-wal` and `-shm` sidecars travel with
it, and it is copied while the stack is stopped. A domain seed that re-seeds the
storage unit no longer touches memory held by the `sqlite` provider.

Domain definitions are **not** plugin configuration: they are durable records in
the plugin's own storage domain, edited in the Domain Experts tab. That keeps an
arbitrarily large expert catalog out of `cordis.yml`.

## Enforcement model

DSH tool filtering is capability scoping, not an operating-system sandbox, so
this plugin never claims more isolation than it has. Every restriction is
reported with one of two levels:

| Restriction | Typical level | What makes it enforced |
| --- | --- | --- |
| Tool policy | `enforced` | The harness removes the tool from the child's view *and* refuses to execute it. |
| Memory namespace | `enforced` | The storage key layout keeps other namespaces out of reach; reads and writes go through the resolved namespace only. |
| Delegation policy | `enforced` | The plugin refuses a delegation the caller's mode or target list forbids. |
| Filesystem scope | `enforced` when a selected worker declares it applies the scope, otherwise `advisory` | A worker that actually restricts path access (`DomainWorker.enforces`). |
| Persona wording | always `advisory` | Nothing but the model's compliance. |

The resolved-scope inspector renders this per resource, and the degraded
sections list what a domain asks for but the deployment cannot supply
(`SCOPE_PROVIDER_MISSING`, `MEMORY_PROVIDER_MISSING`, `WORKER_UNAVAILABLE`,
`TOOL_UNVERIFIED`, `DELEGATION_TARGET_MISSING`).

Path containment is implemented once, in `decidePath`/`resolveWithinRoot`:
denial wins over any allow, a path that no rule classifies is refused, and
`..`, absolute paths, NUL bytes and symlink escapes are rejected before any
match is attempted.

> **Note.** A generic shell tool that can reach the whole machine is not
> constrained by a persona. Filesystem restrictions become real only through a
> worker that consumes the resolved scope — which is why the inspector says so.

## Compatibility

- DeepSeek Harness `>=0.1.5-rc.2 <0.2.0` (tested against `0.1.5-rc.2`)
- Node `^22.19.0 || >=24.0.0`
- Browser half requires the `settings.plugins.tab` slot

See [compatibility.json](./compatibility.json) for the machine-readable form.

## Development

```bash
pnpm install
pnpm --filter @yadsh/dsh-domain-experts typecheck
pnpm --filter @yadsh/dsh-domain-experts test
pnpm --filter @yadsh/dsh-domain-experts build
pnpm --filter @yadsh/dsh-domain-experts verify
pnpm --filter @yadsh/dsh-domain-experts check     # lint, typecheck, test, build, verify
```

`docs/architecture.md` maps the modules; [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-domain-experts/SPEC.md) is the product
contract; the originating design note lives in
`docs/specs/design.md`.

## License

MIT
