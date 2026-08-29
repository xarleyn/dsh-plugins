# @yadsh DeepSeek Harness plugins

`@yadsh` (Yet Another DSH) is a pnpm + Nx monorepo for independently versioned
DeepSeek Harness plugins. Each directory under `plugins/` is its own public npm
package; shared build and test utilities live under `packages/`.

## Packages

| Directory | npm package | Purpose |
| --- | --- | --- |
| `plugins/dsh-doc-impact` | `@yadsh/dsh-doc-impact` | Deterministic documentation-impact tracking |
| `plugins/dsh-draft-sessions` | `@yadsh/dsh-draft-sessions` | Persistent unsent draft sessions |
| `plugins/dsh-l10n-overrides` | `@yadsh/dsh-l10n-overrides` | Runtime localization overrides |
| `plugins/dsh-prompt-firewall` | `@yadsh/dsh-prompt-firewall` | Prompt policy, hygiene, and observability |
| `plugins/dsh-session-scope` | `@yadsh/dsh-session-scope` | Per-session workspace visibility scopes |
| `plugins/dsh-sleev` | `@yadsh/dsh-sleev` | Sleev routing observability |
| `plugins/dsh-ui-repair` | not publishable yet | Design specification only |
| `packages/plugin-kit` | `@yadsh/dsh-plugin-kit` | Shared runtime helpers |
| `packages/test-kit` | `@yadsh/dsh-test-kit` | Shared test helpers |

Runtime plugin IDs remain unscoped (`dsh-*`) because DSH bundle composition and
browser module loading use those IDs. The `@yadsh` scope is the npm package
identity.

## Development

Requirements: Node.js 22 or newer and pnpm 10.4.1.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm deps:check
pnpm tarball:verify
```

Nx runs project-local `lint`, `typecheck`, `test`, and `build` scripts and caches
their outputs. The dependency check enforces workspace boundaries, while the
tarball check packs every public package, validates its manifest and exported
files, and installs it in a clean consumer project.

## Adding a plugin

```bash
pnpm nx g dsh-plugin <name> [--client] [--description "..."]
```

The generator defaults to the `@yadsh` npm scope and creates the package,
Cordis patch, build configuration, tests, and public-package metadata.

## Releases

Packages use independent Nx Version Plans:

```bash
pnpm release:plan
pnpm release:check
pnpm release:dry-run -- --first-release
```

The GitHub release workflow builds and verifies selected package tarballs before
publishing through npm Trusted Publishing. See [the release runbook](docs/RELEASING.md)
and [compatibility policy](docs/COMPATIBILITY.md).

## License

MIT
