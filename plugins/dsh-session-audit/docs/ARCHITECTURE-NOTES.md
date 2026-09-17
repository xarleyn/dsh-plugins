# Architecture notes: DSH integration points

Phase 0 of the session-audit spec: the host and client surfaces this plugin is
built on, verified against DeepSeek Harness **0.1.5-rc.2** (sources at
`D:\repos\dsh\deepseek-harness-source`, checkout `dsh-v0.1.5-rc.2`).

Every fact below is a claim about the harness, not about this plugin. Where the
harness offers no extension point, the note says so and states the adaptation
this plugin uses instead — the SPEC is a design document and two of its
assumptions do not survive contact with 0.1.5-rc.2 (marked **Adapted**).

## 1. Conversation view registration

**Confirmed.** A plugin adds a conversation tab by registering into the
`conversation.view` slot, which the conversation subsystem declares as a `list`
slot scoped to a session:

- Declaration (the seat's owner): `packages/client/ui-conversation/src/client/contract/slots.ts:156`
  ```ts
  'conversation.view': { kind: 'list'; scope: 'session'; owner: ConvViewOwnerProps }
  ```
- Registration API: `ctx.slots.register(options, Component)` plus the mandatory
  `ctx.slots.inject('conversation.view', () => ...)` wrapper. Registering before
  the parent declares the child throws
  `slot "conversation.view" is not declared`.
- Shipped occupants: `chat` at `order: 0`
  (`packages/client/ui-chat/src/client/apply.ts:96-107`) and `trajectory` at
  `order: 10` (`packages/client/ui-trajectory/src/client/index.ts:80`).
- The component is a **plain function component** — `SlotComponent<P> = (props: P) => ReactNode`.
  A class component does not satisfy the slot call signature.
- Props carry `sessionId`, `useSession`, `useProjection`, `useSessions`, and the
  owner share (`viewRequest`, `openView`, `completeViewRequest`).
- The tab strip renders only while `tabs.length > 1`; the fallback label is the
  entry `id`, so a `label` is what a user reads. Labels are i18n thunks
  (`label: () => t('view.audit')`) re-read on locale change.
- `order` decides position; ties keep registration sequence.

**Consequence for this plugin:** `Audit` registers with `order: 20`, after
Trajectory.

**Refuted:** the SPEC's `Chat | Trajectory | Context | Audit` ladder does not
exist in 0.1.5-rc.2 — there is no `Context` view. The real strip is
`Chat | Trajectory | Audit`. The SPEC's §36 layout is therefore satisfied with
`order: 20` rather than "after Context".

## 2. Session identity

**Confirmed.** The session id is an opaque branded string (`SessionId`). The
browser client reads the open session as
`ctx.sessions.list.getSnapshot().current`, and inside a `conversation.view`
component the id arrives as the `sessionId` prop — no lookup needed.

Ids are minted as `session-<uuid>` by the session controller
(`packages/api/session-controller/src/commands.ts:91`) and as `session-<n>` by
the in-memory store (`packages/core/session/src/index.ts:963-966`). The id is
never an integer and never parseable.

**Consequence:** the SPEC's prefix resolution (§15) cannot lean on a host API —
there is none. See §4 below.

## 3. Host-side session listing

**Confirmed.** Two services enumerate sessions:

| Service | Accessor | Corpus |
| --- | --- | --- |
| `ctx.sessions` | `list(): Session[]`, `get(id)` | live, in-memory only |
| `ctx.sessionQuery` | `listSessions(signal): Promise<SessionRecord[]>` | live-preferred **plus** the persisted corpus |

`SessionRecord` is `{ header: SessionHeader, live: boolean, persisted: boolean }`
and `header.id` is the full session id.

There is **no find-by-prefix API anywhere** in the harness (`session-query`
exposes exact-id `readSession`/`observeSession` only).

**Adapted:** this plugin's `SessionResolver` lists the full corpus through
`ctx.sessionQuery.listSessions()` when the service is present, falls back to
`ctx.sessions.list()` when it is not, and performs prefix matching itself.

## 4. Plugin-to-plugin service provision

**Confirmed.** A plugin registers a service with `ctx.provide(name, value)` or,
as a class plugin, `super(ctx, '<name>')` on a `Service` subclass. A provider
does **not** list its own service in `inject`.

A consumer that can live without the provider reads `ctx.get(name)`, which
returns `undefined` for an absent service **and** for a service whose fiber is
not yet `ACTIVE` (strict by default) — exactly the "optional dependency"
semantics the SPEC asks for. `ctx.inject([name], cb)` is the reactive variant:
the callback starts when the service appears and is torn down if it disappears.

**Adapted:** the SPEC (§30) sketches `ctx.provide("session-audit.provider", …)`
and `ctx.resolve(...)`. There is no `ctx.resolve` in Cordis 4.0.2. The service
key is `sessionAudit` (domain name, no dotted prefix — matching the repo's
`draftSessions`/`pluginLogUi` convention), and optional consumers use
`ctx.get('sessionAudit')`.

## 5. Host → client transport

**Confirmed, with a constraint the SPEC did not anticipate.** The harness has
three mechanisms, and only one is open to a third-party plugin:

| Mechanism | Reachable by a third-party plugin |
| --- | --- |
| Session projections (`ctx.sessionProjections`) | yes, but *fold-over-session-events only* — a unit's `apply(state, event)` is driven by the framework on committed session events. An audit artifact appearing on disk is not a session event, so an out-of-band push is not expressible. |
| Forwarded Cordis events (`ctx.remote.$on`) | **no** — the legal event set is a closed host-side allowlist (`packages/api/remotes/src/remote-events.ts:16-36`). A plugin cannot add its own. |
| Plugin Remote (Typert) | yes — `TypertRemoteService` + `@Remote`, client mounts with `ctx.remote.$mount(contribution)` and calls `ctx.remote.<namespace>.<method>()`. Pull/RPC only. |

**Adapted — this is the SPEC §35 "fallback", promoted to the design:** the
frontend gets its data through a plugin Remote, and freshness through
visibility-aware polling (the repo's own `startVisibilityAwarePolling` from
`@yadsh/dsh-plugin-kit/client`, the same mechanism `dsh-plugin-log-ui` uses).
The polling read is the cheap summary endpoint the SPEC §32 asks for: one map
lookup per session, no file I/O. Polling is not the primary architecture in the
sense that matters — the host registry is event-driven (watcher + reconciliation)
and the client only re-reads a materialised summary.

## 6. HTTP API namespace

**Refuted.** There is no `/api/plugins/<name>` namespace in the harness, and no
route may introduce one: `connection.fetch.register` accepts a single path
segment under `/api` (`/api/<name>`), enforced by `ENDPOINT_SEGMENT_PATTERN`
(`packages/client/connection/src/rpc-host.ts:292-303`).

**Adapted:** the SPEC §31 endpoint list is a *provider* contract, not a URL
contract. It is realised as Remote methods on the `sessionAudit` namespace:

| SPEC endpoint | Remote method |
| --- | --- |
| `GET /sessions/:sessionId/summary` | `sessionAudit/summary` |
| `GET /sessions/:sessionId/audit` | `sessionAudit/audit` |
| `GET /sessions/:sessionId/audits` | `sessionAudit/audits` |
| `GET /audits/:auditId/analysis` | `sessionAudit/analysis` |
| `GET /audits/:auditId/report` | `sessionAudit/report` |

Path containment (§63) is enforced against the registry entry's own recorded
paths rather than against a caller-supplied path — stronger than the SPEC's
formulation, because no filesystem path ever crosses the wire.

## 7. Config schema

**Confirmed.** `@deepseek-ai/schemastery` (`z.object(...)`, `static Config` on
class plugins). `$DSH_HOME` resolves through `@deepseek-ai/dsh-home-paths`:
`resolveDshHome(configured)` → explicit config, else `$DSH_HOME`, else `~/.dsh`.
That package is in this repo's `dsh` catalog, so the plugin declares it as a
peer.

## 8. Filesystem watching

**Confirmed.** The harness itself uses `chokidar` for directory watching
(`packages/skill/skill-filesystem/src/index.ts:486-503`) with
`ignoreInitial`, `awaitWriteFinish`, and `atomic`. There is **no shared watcher
service** — each package owns its watcher. `canonicalizeWatchPath()` from
`@deepseek-ai/dsh-home-paths` is the helper for canonicalising a watch target on
Windows.

**Consequence:** this plugin depends on `chokidar` directly (SPEC §22's stated
preference) and keeps the reconciliation timer as the authority — a watcher
event only *schedules* a re-check.

## 9. Build and packaging

**Confirmed** (repo-local, §4 of `docs/PLUGIN_GUIDELINES.md`):

- Host + client plugin: `src/index.ts` (host) + `src/client/index.tsx`
  (browser), two tsdown entries, the client bundle registering through
  `window.__ModuleLoader__.load({ id: "<full package name>", … })`.
- Remote artifacts come from `@yadsh/dsh-plugin-scripts/generate-typert`, run in
  `build` before `tsc`; it emits `lib/typert.host.js` and
  `lib/typert.remote-client.js`, which `package.json#exports` must map to
  `./typert` and `./remote` respectively.
- The `sessionAudit` service must be discoverable by that generator: the class
  extends `TypertRemoteService` with a `namespace`, and every exposed method
  carries the `@Remote` decorator.
