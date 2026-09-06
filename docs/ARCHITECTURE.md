# Architecture overview

A short map of the monorepo for humans. The full normative specification is
[dsh-plugins-monorepo-SPEC.md](../dsh-plugins-monorepo-SPEC.md); the plugin
rulebook is [PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md).

## Layout

| Directory | Contents |
| --- | --- |
| `plugins/*` | One independently versioned plugin per directory (public npm packages `@yadsh/dsh-*`) |
| `packages/plugin-log` | The only published shared package: structured file logging + runtime consumer discovery |
| `packages/plugin-kit` | Private shared runtime helpers, incl. `@yadsh/dsh-plugin-kit/client` (settings-card scaffolding) |
| `packages/config` | Private shared tsconfig presets (`tsconfig/{base,node,browser}`) and the Vitest preset |
| `packages/test-kit` | Private shared test helpers (`createMockContext`, `createTempFixture`) |
| `tooling/generators/dsh-plugin` | `pnpm nx g dsh-plugin` scaffold generator |
| `scripts/` | Repo-level gates: hygiene, card contract, logging contract, dependency check, packed-tarball verify |
| `docs/` | Human documentation (this file, guidelines, logging, releasing, compatibility) |
| `.dsh/doc-impact.yml` | Documentation-impact rules — the monorepo dogfoods its own doc-impact plugin |
| `.nx/version-plans/` | Nx Version Plans driving independent package releases |

## Host process vs browser client

Every plugin ships two artifacts:

1. **Host plugin** (`lib/index.js`) — a Cordos plugin loaded in the DSH host
   process. Declares `name`/`inject`/`apply(ctx, config)` plus a `Config`
   schema; registers commands, tools, RPC services, and settings sections.
2. **Browser client** (`lib/client.js`, optional) — a classic IIFE bundle for
   the DSH web app. It must register through
   `window.__ModuleLoader__.load({ id, factory })` where `id` is **exactly**
   the package's full `package.json` name (scope included), and it is served
   at `/plugins/<full-package-name>/client.js`. Client bundles are
   self-contained: React (and any helpers from `@yadsh/dsh-plugin-kit/client`)
   are inlined at build time by tsdown.

The settings-card UI contract (shell classes, chevron SVG, header structure)
is specified in [AGENTS.md](../AGENTS.md), implemented once in
`packages/plugin-kit/src/client/`, and enforced by
`scripts/verify-plugin-card-contract.mjs` plus per-plugin `verify:client`.

## Build outputs

- Plain host packages compile with `tsc` to `lib/` (`lib/index.js` +
  `lib/index.d.ts`).
- Client-bearing packages compile the host with `tsc` and bundle the client
  with tsdown (`lib/client.js`, types under `lib/types/`).
- Everything ships from `lib/`; `dist/` layouts are retired. Build outputs are
  gitignored and never edited by hand.

## Dependency rules

- Plugins may depend on shared packages; shared packages must never depend on
  plugins (`pnpm deps:check` enforces this).
- `@deepseek-ai/*` runtime packages are always `peerDependencies`; the exact
  development copies come from the `catalog:dsh-dev` pnpm catalog.
- Compatible peer ranges live in `catalog:dsh`; see
  [COMPATIBILITY.md](COMPATIBILITY.md) for the tested matrix.

## Release model

Packages version independently through Nx Version Plans
(`pnpm release:plan` / `release:check`). The GitHub release workflow verifies
packed tarballs and publishes through npm Trusted Publishing; see
[RELEASING.md](RELEASING.md). There are no npm tokens in the repo and no
tag-based releases.
