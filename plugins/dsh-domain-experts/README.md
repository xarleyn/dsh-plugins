# Domain Experts

Give a part of your product its own expert agent: one persona, one scope, one
memory namespace, one tool policy — configured in the DSH Web UI and executed
as an ordinary DeepSeek Harness subagent.

Structured reviewers can delegate verification through the tools available to
their domain, including deployment-owned aliases. Each delegation returns its
completed result in the same tool call. Local descendants also wait for their
children, subject to the Host's depth and capacity limits. The reviewer evaluates
the returned evidence before submitting `structured_output`.

When the answer review gate requires a tool allow-list, the managed reviewer and
its local workers also enforce that list at dispatch. Include trusted delegation
tools by name. External workers cannot accept this scoped policy.

Native structured review output requires a `comparisons` array independently
of its prose summary. Each document witness names its `source` and `target`
evidence keys, verbatim `sourceQuote` and `targetQuote` passages, and an
`explanation`. Consumers must validate these model-supplied witnesses against
the exact files and this reviewer's reads before approving a document.
Use `[]` when no document pairs were requested. Quotes must preserve a contiguous
passage, including Markdown pipes; abbreviated rows are not verbatim evidence.

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
  not a sentence in a prompt. Where the deployment has accounts, the private
  namespace is one per account (`domain/payments/u/<account>`) and the domain's
  own namespace stays read-only for every account — what one account's expert
  learned is not a rule another account inherits. A note has to say who it is
  true for: what only this caller's access showed (a tool that was refused, a
  source that was not mounted) is the caller's situation, and the key layout
  keeps it out of the common tiers.
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

Then open the **Domain Experts** row of the Host's **Plugins** page.

## Managing domains

Host plugins can run a structured image review through
`ctx.domainExperts.reviewExpert(domainId, task, parentSessionId, images)`.
It forwards already admitted durable image blocks to the expert child, where
the Host applies the selected model's image capabilities and limits. This entry
is in-process only; the browser test API does not accept attachment refs.
Reviews require the exact live parent session so the expert inherits the model
and workspace of the chat being reviewed.

The tab lists every domain with its scope counts and degradations. `Edit` — or
the card itself — opens one in the same pane: identity and status, persona,
filesystem and knowledge scope, memory namespaces, tool policy, cross-domain
delegation, model route, the test screen and the Runs tab. The current-process
list reads the bounded audit ring and shows the caller session, delegation path
and outcome. `All domains`
goes back to the list,
asking first when the form holds unsaved edits, and `Save` writes the record in
place. Every domain is an ordinary record in the plugin's storage, no matter who
created it: there is no built-in expert the UI refuses to change.

### Search execution history

Enable `executionAuditEnabled` in the Domain Experts Host settings, then open a
domain's **Runs** tab and choose **Search archive**. For example, select
`review`, `error` and `foreground` to find failed reviews and their durations
across restarts. The Host operator can also call
`domainExperts/queryExecutionAudits` with `domainId`, `runId`, `mode`, `status`,
`execution`, `since`, `beforeId` and `limit`. Use empty strings for unused enum
filters and zero for unused numeric filters. Pass the returned `nextBeforeId`
to fetch an older page. The maximum page size is 100.

The archive retains up to 7 days and 10,000 entries per Host home, across all
domains. Each entry contains an archive-local run ID, event time, domain ID,
mode, status, foreground or background, and duration in milliseconds. Task
content, output, retrieved memory, credentials, session IDs and delegation paths
are excluded. The Host writes foreground outcomes and accepted background
dispatches. For a background run the duration covers dispatch. Rejections
before subagent activation and background completion are outside this history.

Committed entries survive restarts when the Host reopens the same
`<DSH_HOME>/domain-experts-audit.db` file (working directory when no home is set).
Expiry runs on open, on writes and every 15 minutes while the plugin runs,
including when a previously enabled archive is disabled. Disabling it stops
writes and queries. Host log configuration has its own retention and log level,
and historical log files are never imported. Write failures are reported in the
plugin log while the expert returns its original result.

## Tools

The plugin registers three agent-facing tools.

| Tool | Purpose |
| --- | --- |
| `domain_expert` | Ask one domain's expert to investigate, answer or review something. Called from inside an expert it is a delegation, and the caller's cross-domain policy decides whether it is allowed. |
| `domain_experts_list` | Identifiers, names and one-line descriptions of the enabled domains. Scope, memory and policy stay out of the model's view. |
| `domain_memory` | Read and write the calling expert's own memory. Only namespaces resolved from the persisted definition are reachable, and only the caller's own namespace accepts writes — that is the account's namespace where the deployment keeps memory per account. A write that records nothing — an acknowledgement, a placeholder, an echoed command, «nothing was found», a text too short to carry a fact — is refused with the reason, because whatever is stored is recalled into every later answer of that domain. |

`domain_delegate` is accepted as a tool-policy alias for `domain_expert` so a
configuration written against the design vocabulary is not reported as
degraded.

An expert uses the calling agent's current provider and model, including in
background runs and reviews. The primary agent can request a different model
with both `provider` and `model`, or use `use_domain_model: true` to request the
alternative saved in the domain settings. Each model change needs explicit
approval before the child starts. In QA with interactive approvals enabled,
the chat owner sees the current and requested models and can approve the launch
once. The requested model must be available and permitted by the chat's role.

## Configuration

Plugin settings are live fields of this plugin's own profile configuration, and
the Host serves their form for the `dsh-domain-experts` entry. The
**Domain Experts** page on the Plugins panel manages the domains themselves. Changes apply to subsequent operations.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Register the agent-facing tools and serve the management UI. |
| `subagentProvider` | string | `spawn` | `ctx.subagents` provider used to spawn expert children. |
| `defaultMaxDepth` | number | `3` | Delegation depth cap pre-filled on new domains. |
| `defaultMaxParallel` | number | `3` | Parallel experts allowed per calling session when the caller is not itself an expert. |
| `defaultCrossDomainMode` | string | `expert-only` | Cross-domain mode pre-filled on new domains: `disabled`, `expert-only` or `direct-read`. |
| `defaultMemoryProvider` | string | `builtin` | Memory provider id every expert uses. Providers are registered when the plugin loads, so naming one the deployment did not start with takes a restart. |
| `memoryDbPath` | string | `<DSH_HOME>/domain-experts-memory.db` | Database file the `sqlite` memory provider owns. |
| `perUserMemory` | boolean | `true` | Keep a separate memory namespace per account, in a deployment that has accounts. Takes effect only while the host's accounts surface is mounted. |
| `recallLimit` | number | `5` | Memory records recalled into an expert's persona. |
| `auditLimit` | number | `200` | Execution audit entries kept in the current process. |
| `executionAuditEnabled` | boolean | `false` | Retain bounded execution metadata for the Host operator across restarts. |

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

What an expert recorded is maintenance data, not a write-once log. The service
exposes a host-plane seam for it — `ctx.domainExperts.memoryAdmin` — which lists
every namespace the enabled experts declare, including existing per-account
namespaces in the configured memory provider, searches one, corrects a record in
place, and deletes one record, a named set, or a whole namespace. It is not a
Remote: a browser must not hold an unauthenticated write endpoint over the store
that feeds every expert's prompt, so the calling surface — the QA console in
`@yadsh/dsh-qa-surface`, behind its own permission check — carries the identity.
Writes reach only a namespace some enabled expert owns as its private one, a
correction of a record that vanished meanwhile is refused instead of re-created,
and an operator's edit is never filtered as a model's would be.

Domain definitions are **not** plugin configuration: they are durable records in
the plugin's own storage domain, edited in the Domain Experts tab. That keeps an
arbitrarily large expert catalog out of `cordis.yml`.

An empty tool allow/deny configuration keeps the resolved expert infrastructure
filter (`domain_expert` and `domain_memory`); it does not inherit the Host's
entire tool catalog. The expert's own scoped documentation and evidence tools
remain available. The same filter is applied when starting a new or continuable
expert, before its first model request.

Cross-domain access has one effective switch: turning off `allowCrossDomain`
also turns off the namespaces selected in `directRead`. They remain saved but
are absent from automatic recall, the memory tools and the inspector.

A resumed expert still answers to its current domain's delegation policy.
After restart or live-index eviction, the plugin reads the creation label from
the Host's durable parent-owned child catalog. Missing or unreadable identity
is refused with `EXPERT_NOT_CALLER`; a positively identified ordinary subagent
keeps ordinary caller access. A catalog read has a five-second deadline and
honours tool cancellation. Cold attribution recovers delegation identity, not
account memory ownership: `domain_memory` continues to require a live expert
record, and a cold delegation audit records only the known caller-to-target
suffix.

## Edit provider scope settings

Open a domain in **Plugins → Domain Experts** and select **Resources**.
A scope provider can contribute fields for its configuration. Changes use the
domain's **Save** button. Provider entries without a form, unavailable providers
and unsupported versions remain visible as read-only entries.

A plugin can supply `configForm` on the provider passed to
`ctx.domainExperts.registerScopeProvider(provider)`. Form version 1 supports
`text`, `integer`, `boolean` and `choice` fields. Use a stable field key that
matches a top-level JSON property. Set `required` for mandatory values and
supply `options` with values and labels for choices. Use an empty options list
for other fields. Increment the form's `revision` whenever its contract changes.

```ts
const configForm = {
  version: 1,
  revision: 1,
  documentVersion: { key: "schemaVersion", current: 2 },
  fields: [
    {
      key: "collection",
      label: "Collection",
      kind: "text",
      required: true,
      options: [],
    },
  ],
} satisfies ScopeProviderForm
```

Import the `ScopeProviderForm` type from
`@yadsh/dsh-domain-experts/types`. Set `documentVersion` to `null` for an
unversioned document. With a version key, an existing object that lacks it
receives the current version on the first successful form edit. A document
with an unrecognized version remains read-only. Forms should describe operator
settings. Credentials belong in the provider's credential configuration.

The Host applies only edited keys and validates the resulting document with
the provider's `validate(config)` callback. Clearing an optional field removes
that key. Unknown fields remain in the document, including the numeric tokens
of opaque data. Untouched provider documents keep their original bytes. Saving
an edited provider whose configuration or form revision changed requires
reopening the domain.

## Import and export a catalog

In the Plugins panel, open Domain Experts and expand **Import or export
catalog**. Export downloads a UTF-8 JSON document sorted by domain ID. To
import, choose a file and mode, review the actions for each ID, then apply.
Only the Host operator can use these operations.

| Mode | Existing ID with different data | New ID | Installed ID absent from file |
| --- | --- | --- | --- |
| Merge | Keep installed definition | Add | Keep |
| Replace | Update the definition | Add | Remove |

Both modes keep unchanged definitions as they are. A preview makes no writes.
Apply requires the exact file, mode and catalog state from the preview.
Concurrent edits or a Host restart require a new preview. Each apply publishes
one durable catalog snapshot, so additions, updates and removals land together.

The envelope has `format: "dsh-domain-catalog"`, `version: 1` and a
`domains` array, with at most 500 definitions and 512 KiB per document.
Definitions carry the ID, display fields, persona, built-in filesystem and
documentation scopes, memory namespace references, tool policy, delegation and
model selection. Import validates the complete document before planning. An
unknown version, duplicate ID, unknown field or invalid definition is refused.

Credentials, stored memory, audit records, timestamps and opaque configuration
under `scope.providers` are outside the transfer format. Replacement retains
the destination's provider configuration for a matching domain ID. Configure
providers locally for newly added domains. Export and import also refuse
recognizable credentials in included text. Review free-text fields before
sharing an export, since arbitrary private text has no reliable marker.
Removing a definition leaves its memory records on the Host.

Existing installations read their stored domain rows until the first catalog
write. From then on storage unit v2 reads the committed snapshot. Back up the
storage before upgrading if you need to return to an older build.

## Enforcement model

DSH tool filtering is capability scoping, not an operating-system sandbox, so
this plugin never claims more isolation than it has. Every restriction is
reported with one of two levels:

| Restriction | Typical level | What makes it enforced |
| --- | --- | --- |
| Tool policy | `enforced` | The harness removes the tool from the child's view *and* refuses to execute it. |
| Memory namespace | `enforced` | The storage key layout keeps other namespaces out of reach; reads and writes go through the resolved namespace only. In an account-scoped deployment the writable namespace is the caller's own account, and a run nobody claimed is refused a write rather than shown the door — the namespace it would reach is what every account reads. |
| Delegation policy | `enforced` | The plugin refuses a delegation the caller's mode or target list forbids. |
| Filesystem scope | `enforced` when a selected worker declares it applies the scope, otherwise `advisory` | A worker that actually restricts path access (`DomainWorker.enforces`). |
| Persona wording | always `advisory` | Nothing but the model's compliance. |

The resolved-scope inspector renders this per resource, and the degraded
sections list what a domain asks for but the deployment cannot supply
(`SCOPE_PROVIDER_MISSING`, `MEMORY_PROVIDER_MISSING`, `WORKER_UNAVAILABLE`,
`TOOL_UNVERIFIED`, `TOOL_UNFILTERABLE`, `DELEGATION_TARGET_MISSING`).

A `N degraded` chip lists limitations that need to be read individually.
`TOOL_UNVERIFIED` in the inspector means that the resolver cannot validate an
ordinary tool name such as `read` against a live child's registry. On a local
managed provider, the plugin reserves the child id and applies `tools.restrict`
to that child's context in the awaited `agent/created` lifecycle event, before
the first prompt is submitted. The Host validates names, hides restricted
inherited tools and refuses their execution; the child's own structured-output
machinery remains available. A successful installation clears that uncertainty
from the run's audit. An unknown allowed tool refuses creation with `WORKER_UNAVAILABLE`;
the run is never retried with a weaker policy. A backend without local child
creation is refused when a policy is configured. An adapter without this
lifecycle capability still reports `TOOL_UNFILTERABLE`.

Path containment is implemented once, in `decidePath`/`resolveWithinRoot`:
denial wins over any allow, a path that no rule classifies is refused, and
`..`, absolute paths, NUL bytes and symlink escapes are rejected before any
match is attempted.

> **Note.** A generic shell tool that can reach the whole machine is not
> constrained by a persona. Filesystem restrictions become real only through a
> worker that consumes the resolved scope — which is why the inspector says so.

## Compatibility

Tools registered by the child's own preset remain outside the Host's inherited
tool mask. An explicitly allowed local tool must exist in that exact child's
registry. Explicit denials also use a scoped execution guard, covering local
tools and tools registered later without changing sibling agents. Reserved
execution transports cannot be admitted as local tools.

The host-only `reviewExpertBounded` entry supports independent answer review with
an abort signal, wall-clock timeout, completed-tool-call limit and consecutive
tool-error limit. Limits cover that managed child and its delegated descendants,
while human forks and unrelated agents remain separate. A successful call
resets the error streak; native structured result capture is exempt. Exhaustion
disposes the activation and reports an error instead of returning an incomplete
verdict. Ordinary expert calls keep their existing lifecycle.

- DeepSeek Harness `>=0.2.2-rc.3 <0.3.0-0` (tested against `0.2.2-rc.3`)
- Node `^22.19.0 || >=24.0.0`
- Browser half requires the `plugins.bundle.config` seat

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
