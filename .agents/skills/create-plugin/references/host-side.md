# Host side: cordis, config, tools, storage, typert

Facts verified against the harness sources (0.1.5-rc.2 line) and paid for in
incidents. Canonical narrative: `docs/PLUGIN_GUIDELINES.md` §3.

## Cordis service visibility

- `ctx.get(name)` strict (default) returns `undefined` until the provider
  fiber reaches ACTIVE. A plugin composed from a profile early (or reading a
  late-activating service like credentials) captures `undefined` — if it
  stores that reference in a constructor field, it stays dead forever.
- Correct patterns: read the service **per call** inside methods (first-party
  idiom), or declare a hard `inject = [...]` on the entry/face when the
  dependency is mandatory.
- There is NO optional-inject form (`{required, optional}`) in this cordis:
  inject is all-or-nothing — one unresolved service leaves the whole fiber
  INACTIVE and the plugin does not load. Optional dependency = soft per-call
  `ctx.get(name) as T | undefined` + an honest degradation path.
- Layer 2 of the same trap: reading a service that is not in the fiber's
  `inject` throws `cannot get property "x" without inject` — but only on a
  fiber with a plugin runtime. A bare `new Context()` read succeeds softly,
  which is exactly why unit tests on a bare context cannot reproduce this bug
  class (see Testing below).

## Composition entry, dispose, side effects

- No global side effects at module import; initialize in `apply()`.
- `apply()`/`dispose()` must be symmetric: timers, watchers, leases, child
  fibers — everything gets an owner and a cleanup path (plugin reload and
  removal call dispose).
- Do not check harness versions; feature-detect capabilities and record the
  supported range in `compatibility.json`.

## Configuration

- User-facing config is Schemastery (named `Config` export convention);
  storage record schemas are Zod — the two coexist, do not mix them.
- Pattern (`plugins/dsh-git-readonly/src/config.ts`): a schema with defaults +
  JSDoc on every field, and a `resolve…Config` function that normalizes raw
  values into fully defaulted, clamped data, so consumers never handle
  optional fields or unsafe limits.
- Optional plugin settings section: `ctx.settings.installSection(...)` via
  `ctx.inject(['settings'], …)` — then the plugin still works (on its
  composition entry) when the settings service is absent.

## Tools

- `defineTool` requires `output: { schema, render }`. On a finished
  ToolDefinition, `.parameters` is already JSON Schema (`{type:'object',
  properties:{…}}`), not a DSL spec.
- Parameter names are a security contract: a repo gate greps serialized tool
  definitions for personality-selector names (`userId` and friends). A
  harmless "by whom" filter must be named differently (e.g. `loggedBy`).
- Tool output seams: prefer the established post-execute seam (`tools/
  post-execute`) over wrapping execution — replacing `tools/execute` breaks
  `output.schema` handling.

## Subagents (if the plugin delegates)

- Service is `ctx.subagents` (plural). `start(providerName, request)`;
  required request fields: `prompt`, `parent`, `signal`; optional: `label`,
  `persona`, `toolFilter` (`{allow?, deny?}` over GLOBAL tool names),
  `maxDepth`, `agentOptions` (`provider/model/reasoningEffort/maxTokens`),
  `outputSchema`.
- Returns `SubagentRun` `{id, localAgent, result, dispose()}`: `result` is a
  single terminal promise (no stream) and does NOT reject on child error —
  branch on `stopReason`; `dispose()` is idempotent.
- Depth is a runtime-enforced cap; `SubagentDepthError extends Error` (not
  `SubagentError`). Unsupported composition errors as `UNSUPPORTED_CAPABILITY`.
- `toolFilter.allow` with an unknown tool name throws `names unknown global
  tool …` and kills `start()` — validate names or catch and translate.

## Storage domains

- `defineDomain({name, version, tables})` + `domainTable<K,V>(zodSchema)`;
  the unit name must match `^[a-z][a-z0-9_]*$`.
- `await ctx.storageDomain.open(spec)` — the caller owns `close()`;
  `domain.table('x')` reads are synchronous.
- Default `invalidRecords` is strict: one broken record fails `open()` with
  `DomainError('invalid-record')` and detail `{table, key}`. That is the
  "do not lose data" stance; do not add silent drops (anti-pattern list).

## Session journal: do not write custom events

- `Session.append(type, data)` cannot mark events `ignorable`, and the reader
  (`validateStoredEvents`) refuses journals containing unknown types without
  that marker. A plugin writing its own event types produces a journal that
  any build without the plugin refuses to resume — and the
  `KNOWN_SESSION_EVENT_TYPES.add(...)` hack only works when the plugin and the
  harness share one module instance, which is not guaranteed (verified:
  workspace plugin vs harness source resolve different copies).
- Consequence (already applied in shipped plugins): keep provenance/warnings
  in the plugin's own store (`$DSH_HOME/<plugin>-….json` or a storage domain)
  and use plugin-log audit entries instead of journal events.
- 0.1.6 adds a second required-on-read category (`MESSAGE_PROJECTION_
  EVENT_TYPES`, e.g. `image/offload`) — events that must carry a projection.

## Typert / Remote services

- `class X extends TypertRemoteService` + `super(ctx, 'serviceName',
  {namespace})` + `@Remote('name')` on methods; the package needs `./remote`
  and `./typert` exports; artifacts come from
  `packages/plugin-scripts/generate-typert.mjs`.
- The generator type-checks with its own tsconfig (`exactOptionalPropertyTypes:
  true`) and only sees the package's own `src/`:
  - optional fields: declare `readonly field?: T | undefined` explicitly
    (TS2379/TS2375 at build, while `tsc --noEmit` is green);
  - no conditional spread into DTOs (`...(cond ? {flag: true} : {})`) — build
    branches explicitly;
  - no `Partial<Record<string, X>>` on the Remote boundary — `undefined` is
    not JSON (`Remote boundary contains non-JSON type undefined`); use a full
    `Record` or an array of pairs;
  - public members need explicit type annotations (`readonly registry:
    AuditRegistry = …`, not an inferred initializer);
  - DTO types referenced by Remote signatures must be declared locally in the
    package `src/` — a type from another workspace package is invisible to
    the analyzer (metadata fields from `@yadsh/dsh-plugin-kit` types do pass
    through, but declare your own DTOs locally).
- Wire shape is `{args: {...}}`: parameters must be required, no
  destructuring-with-options.
- After adding `@Remote` methods, typecheck stays red until `lib/types` is
  rebuilt: run `tsc -p tsconfig.build.json` AND `node scripts/generate-typert.mjs`
  before `typecheck`.
- Client `./remote` self-import needs the ambient shim `src/client/
  remote-shim.d.ts` (nx typecheck depends on `^build`, not on your own build;
  on a clean checkout `lib/typert.remote-client.d.ts` does not exist → CI
  TS2307 while local is green on stale `lib/`):

  ```ts
  declare module "@yadsh/<pkg>/remote" {
    import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
    const contribution: TypertRemoteContribution;
    export default contribution;
  }
  ```

  Reproduce with `mv lib lib.bak && pnpm typecheck`. The shim is the accepted
  contract — do not "fix" it via `dependsOn: build`.
- Do not narrow the client `apply(ctx)` parameter to gateway/ClientRemote
  types; take plain `Context` and read the face with one cast — generated
  remote declarations are not a foundation for signatures (CI red vs local
  green incident, 2026-09-16).
- Mixing host and client session types in one tsconfig program poisons the
  type (`Context.sessions`): do not import the host session package from a
  package with a client half; derive ids structurally.

## Testing recipes

- `new Context()` + `ctx.provide(name, value)` — NOT `ctx.set` (throws
  `cannot set property … without provide`).
- `ctx.<service>` returns a tracing proxy, not the instance: assert behavior
  or `ctx.get(...) !== undefined`, never identity.
- For inject-contract bugs load the plugin for real:
  `await ctx.plugin(moduleObject, config)` after providing the declared
  dependencies; `{enabled:false}`-style config switches trim the wiring, and
  `service.dispose()` stops timers.
- The late-provider regression (consumer constructed before the service
  exists): construct the consumer with the service absent, then provide it,
  then call a method — before the fix the method sees `undefined`; accept a
  resolver `() => ctx.get(name)` instead of a captured instance.
- Remote-namespace inject violations are NOT unit-testable (verified twice:
  cordis gates only inside a plugin fiber; stubs pass broken code). Keep an
  honest smoke (mount + slot registration + props + dispose) with a comment
  that the inject contract is covered by live loading — do not fake coverage.
- Style injection IS testable: install a minimal fake `document` on
  `globalThis` (`querySelector` over an array, `createElement()` returning
  `{dataset, textContent, remove()}`, `head.appendChild` pushing), call
  `apply(ctx)`, assert style keys/content; `delete globalThis.document` in
  `afterEach`.
