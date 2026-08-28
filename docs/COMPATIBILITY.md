# Compatibility Policy

This document defines how the DSH plugins monorepo tracks, declares, and
upgrades its compatibility with [DeepSeek Harness (DSH)](../../README.md).
It implements SPEC §30 (Compatibility policy) together with SPEC §6/§8
(pnpm workspace configuration and catalogs).

## Supported DSH versions

```text
Supported DSH: >= 4.0.0 < 5.0.0
```

- All runtime plugin packages in this repository target DSH 4.x.
- DSH 4.x bundles the `@deepseek-ai/cordis` 4.x runtime, so the catalog range
  `^4.0.0` is the dependency-level expression of this policy.
- New DSH minor releases (4.x) are expected to be backward compatible; plugin
  releases should not require a new DSH minor unless they adopt a new API.
- The next DSH major (5.x) is **out of scope** until this policy is updated.

## Centralized compatible ranges (pnpm catalogs)

Compatible DSH runtime ranges live in **one place**:
the `dsh` catalog in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml):

```yaml
catalogs:
  dsh:
    '@deepseek-ai/cordis': '^4.0.0'
    '@deepseek-ai/dsh-tools': '^4.0.0'
    '@deepseek-ai/dsh-settings': '^4.0.0'
```

Every package references the catalog instead of pinning its own range
(SPEC §6/§8):

```json
{
  "peerDependencies": {
    "@deepseek-ai/cordis": "catalog:dsh"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "catalog:dsh"
  }
}
```

Benefits:

- one place to update compatible DSH ranges — a catalog bump propagates to
  every plugin on the next `pnpm install`;
- no version drift between plugins;
- clean, reviewable diffs (a compatibility change is a one-line diff).

Rules:

1. Never hardcode a `@deepseek-ai/*` range in a package manifest; always use
   `catalog:dsh`.
2. Runtime DSH framework packages are declared as `peerDependencies` (the host
   provides them); they may be repeated in `devDependencies` for local
   typechecking and tests.
3. Bumping a catalog range requires running `pnpm install` and the full
   affected check (`pnpm affected:check`) before merging.

## Handling incompatible major versions

Per SPEC §30, if multiple DSH major versions ever need to be supported with
incompatible behavior, do **not** rely on silent runtime assumptions:

1. **Gate explicitly.** Use explicit compatibility helpers (feature detection
   and version checks in `@scope/dsh-plugin-kit`) rather than guessing at
   runtime. A plugin should fail loudly with a clear message when it is loaded
   on an unsupported DSH major.
2. **Keep the honest range.** `peerDependencies` must reflect the range that
   is actually tested. Do not widen `catalog:dsh` "to make installs pass".
3. **Branch or fork the major.** When a new DSH major requires incompatible
   plugin behavior, either:
   - maintain the 4.x line on a support branch and develop 5.x support on the
     main branch with a new catalog range, publishing a new plugin major; or
   - split support behind explicit helpers inside a single major version of a
     plugin, if the differences can be isolated behind feature detection.
4. **Communicate.** Update this document, the affected packages' README
   `Compatibility` sections (SPEC §29), and the per-package table below in the
   same change.

## Minimum DSH version per package

| Directory                  | Package                    | Role                | Min DSH version | Enforced via                                  |
| -------------------------- | -------------------------- | ------------------- | --------------- | --------------------------------------------- |
| `plugins/draft-sessions`   | `@scope/dsh-draft-sessions` | Plugin (runtime)    | 4.0.0           | `@deepseek-ai/cordis` peer `catalog:dsh` (`^4.0.0`) |
| `packages/plugin-kit`      | `@scope/dsh-plugin-kit`     | Shared runtime lib  | 4.0.0           | `@deepseek-ai/cordis` peer `catalog:dsh` (`^4.0.0`) |
| `packages/test-kit`        | `@scope/dsh-test-kit`       | Dev-only test utils | 4.0.0           | `@deepseek-ai/cordis` peer `catalog:dsh` (`^4.0.0`) |
| `packages/config`          | `@scope/dsh-config`         | Build config only   | n/a             | Private; never installed into a DSH profile   |

Notes:

- "Min DSH version" means the lowest DSH 4.x release whose bundled Cordis
  runtime satisfies the catalog range and against which the package is tested.
- `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-settings` are pre-declared in
  the catalog (SPEC §6) for packages that will adopt them; no package depends
  on them yet.
- New packages must add a row to this table as part of the PR that introduces
  them.

## Upgrade checklist

When changing the supported DSH range:

1. Update the `dsh` catalog in `pnpm-workspace.yaml`.
2. Run `pnpm install` to refresh the lockfile.
3. Run `pnpm affected:check` (lint, typecheck, test, build).
4. Update the supported range at the top of this document and the table above.
5. Update the `Compatibility` section of every affected plugin README.
6. If the change drops support for any DSH version, bump the major version of
   every affected published package.
