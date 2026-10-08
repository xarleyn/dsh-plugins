# Architecture overview

A short map of the monorepo for humans. The full normative specification is
[SPEC.md](../SPEC.md); the plugin rulebook is
[PLUGIN_GUIDELINES.md](PLUGIN_GUIDELINES.md).

## Layout

| Directory | Contents |
| --- | --- |
| `plugins/*` | One independently versioned plugin per directory (public npm packages `@yadsh/dsh-*`) |
| `packages/plugin-log` | Published shared package: structured file logging + runtime consumer discovery |
| `packages/plugin-kit` | Published shared runtime helpers, incl. `@yadsh/dsh-plugin-kit/client` (settings-card scaffolding) |
| `packages/audit-core` | Published shared package: audit artifact domain layer (schema, parsing, validation, atomic publishing) |
| `packages/audit-ui` | Published shared package: audit presentation components (sanitized report, findings, scorecard, JSON view) |
| `packages/plugin-scripts` | Private shared build/verify script runners (`@yadsh/dsh-plugin-scripts/generate-typert`) |
| `packages/config` | Private shared tsconfig presets (`tsconfig/{base,node,browser}`) and the Vitest preset |
| `packages/test-kit` | Private shared test helpers (`fixedClock`, `memoryTable`, `listenerCollector`, log fixtures, module-loader stub) |
| `tooling/generators/dsh-plugin` | `pnpm nx g dsh-plugin` scaffold generator |
| `scripts/` | Repo-level gates: hygiene, card contract, logging contract, dependency check, packed-tarball verify |
| `docs/` | Human documentation (this file, guidelines, logging, releasing, compatibility) |
| `.dsh/doc-impact.yml` | Documentation-impact rules — the monorepo dogfoods its own doc-impact plugin |
| `.nx/version-plans/` | Nx Version Plans driving independent package releases |

Publishability is decided per package, not by directory: anything a published
plugin imports at runtime must be publishable and in the Nx release project
list, while workspace-only build/test helpers stay `private`. `pnpm
plugins:manifest` regenerates the root `README.md` table and `plugins.json` from
the manifests, so those two carry the authoritative list. Each catalogued entry
also records which install contract it honors: `plugin` for a package declaring
`dsh.bundle`, registered on a profile with `dsh plugin --profile <profile> add`,
and `library` for a shared package under `packages/` that a consumer installs
with `pnpm add` and the Host never loads as a plugin.

## Host process vs browser client

Every plugin ships two artifacts:

1. **Host plugin** (`lib/index.js`) — a Cordos plugin loaded in the DSH host
   process. Declares `name`/`inject`/`apply(ctx, config)` plus a `Config`
   schema; registers commands, tools, RPC services, and settings sections.
2. **Browser client** (`lib/client.js`, optional) — a classic IIFE bundle for
   the DSH web app. It must register through
   `window.__ModuleLoader__.load({ id, factory })` where `id` is **exactly**
   the package's full `package.json` name (scope included), and it is served
   at `/plugins/<full-package-name>/client.js`. A client bundle ships its own
   copy of everything it uses — including the helpers from
   `@yadsh/dsh-plugin-kit/client` that tsdown inlines at build time — because a
   plugin is installed on its own and cannot pull a sibling bundle. React is the
   one exception: every `tsdown.config.ts` externalizes `react` — plus
   `react-dom` and `react/jsx-runtime` wherever the client imports them — with
   `deps.neverBundle`, so those stay `require` calls the shell answers and its
   React remains the only copy in the page. Do not assume the shell provides any
   other module.

The settings-card UI contract (shell classes, chevron SVG, header structure)
is specified in [AGENTS.md](../AGENTS.md), implemented once in
`packages/plugin-kit/src/client/`, and enforced by
`scripts/verify-plugin-card-contract.mjs` plus per-plugin `verify:client`.

## Build outputs

- Plain host packages compile with `tsc` to `lib/` (`lib/index.js` +
  `lib/index.d.ts`).
- Client-bearing packages compile the host with `tsc` and bundle the client
  with tsdown (`lib/client.js`). Whether the client module is also part of the
  `tsc` build — the way a package publishes declarations for `./client` — is
  per-package; the bundle itself is always built by tsdown.
- Everything ships from `lib/`; `dist/` layouts are retired. Build outputs are
  gitignored and never edited by hand.

## Dependency rules

- Plugins may depend on shared packages; shared packages must never depend on
  plugins (`pnpm deps:check` enforces this).
- Plugins do not depend on each other unless the provider publishes that edge as
  a deliberate extension API ([SPEC §5.3](../SPEC.md#53-shared-library-direction)).
  The sanctioned edges, the conditions they must meet and the fact that
  `deps:check` does not gate them yet are listed in
  [PLUGIN_GUIDELINES.md §3.1](PLUGIN_GUIDELINES.md#31-границы-монорепо-и-зависимости).
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
