# Backend-mode spike (SPEC §38 B0) — static findings

Verified statically against the pinned harness sources (`dsh-v0.1.5-rc.2`,
and `dsh-v0.1.6-alpha.1` where noted) and by integration tests in this
package. Items that still require a live rig are listed at the end.

## 1. How a profile row becomes a plugin instance

- The profile shim generated for each bundle row re-exports the package's
  **default export**: `export default target.default`
  (`packages/boot/app-boot/src/profile.ts`, `writeModuleFallbackShim`).
- Bare specifiers (not `.` / `cordis:`) resolve through the host's internal
  Node loader: `ctx.loader.internal.import(specifier, bareModuleBaseUrl)`
  (`packages/boot/app-boot/src/index.ts`, `mountRootInclude`). Standard
  Node resolution covers subpath specifiers, so a row naming
  `@yadsh/dsh-jev-compaction/backend` is *expected* to load the `./backend`
  export declared in this package's `exports` map.
- **Conclusion:** the backend entry ships as a subpath export mounted as its
  own profile row. Fallback mechanic (if a live rig rejects the subpath row):
  a second package over a shared workspace core.

## 2. Exactly one engine

- `Context.reflect.provide` **throws if the name is already provided in the
  scope** (`vendor/cordis/src/reflect.ts`). Mounting
  `dsh-compaction-basic` and this engine together is a composition error, not
  a silent conflict.
- **Deployment rule:** remove the `@deepseek-ai/dsh-compaction-basic` row
  when adding the backend entry (rollback = restore that one row).

## 3. Engine construction facts (verified by `tests/integration/engine.test.ts`)

- Cordis validates mount config against the plugin runtime's `static Config`
  and passes the *normalized* value to the constructor; an inherited schema
  would strip the companion sections. The engine therefore declares
  `static Config = z.any()` and validates strictly in
  `resolveJevEngineConfig` (threshold ordering fails the mount loudly).
- `Service` instances register via `ctx.reflect.provide(name, …)` and are
  removed with the owning fiber, so the nested
  `JevCompactionService` (prepended pre-step listener, `/jev-compact`,
  mutex/cooldown state) tears down symmetrically with the engine.
- The inherited `compactIfNeeded` returns `null` without a durably routed
  request (`session.requestHeader()`), and `compactNow` requires an idle
  session (no open turn) — both inherited behaviors are covered by tests
  with a fixture `request/header` and a closed-turn fixture respectively.

## 4. Harness 0.1.6 readiness

- `dsh-v0.1.6-alpha.1` introduces `MESSAGE_PROJECTION_EVENT_TYPES` with
  exactly one member: `image/offload`. The `compaction/*` event types remain
  known and unconstrained, so the inherited bracket protocol
  (`compaction/start` … `compaction/summary` … `compaction/end`) needs no
  projections as of alpha.1. Re-verify on every harness bump; the repo tracks
  the 0.1.6 migration separately.

## 5. Still requires a live rig

1. Mount the subpath row end-to-end on a real profile (the shim + internal
   loader path above) and confirm the engine serves `/compact` through
   `dsh-command-compact` (typert Remote round-trip).
2. Confirm the duplicate-engine composition error surfaces as a clean
   startup diagnostic (not a crash loop) on the docker kit.
3. One 0.1.6-alpha host run with the engine mounted (journal readability
   across the format boundary).
