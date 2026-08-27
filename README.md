# DeepSeek Harness Plugins Monorepo

A clean, scalable monorepo for multiple DeepSeek Harness (DSH) plugins.

## Architecture

```
dsh-plugins/
├── plugins/           # Individual DSH plugins
│   └── draft-sessions/  # Draft sessions plugin (reference implementation)
├── packages/          # Shared libraries
│   ├── config/        # TypeScript and build configuration
│   ├── plugin-kit/    # Runtime helpers for plugins
│   └── test-kit/      # Testing utilities
├── .nx/               # Nx cache & version plans
├── .github/           # CI/CD workflows
├── nx.json            # Nx configuration + release settings
├── pnpm-workspace.yaml # Workspace definition + catalogs
└── tsconfig.base.json  # Shared TypeScript config
```

## Plugin Catalog

| Plugin | Package Name | Description |
|--------|-------------|-------------|
| draft-sessions | `@scope/dsh-draft-sessions` | Manage session drafts and previews |

## Workspace Architecture

- **pnpm workspaces** — dependency management, workspace linking, shared lockfile
- **Nx** — project graph, affected builds, task caching, release automation
- **TypeScript** — centralized configuration via `packages/config`
- **Vitest** — unified testing framework
- **tsdown** — lightweight bundler for build output

## Development Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Check only affected packages
pnpm affected:check
```

## Adding a New Plugin

```bash
pnpm nx g dsh-plugin <name> [--client] [--description "..."]
```

This scaffolds a new plugin with standard package metadata, DSH bundle configuration, and build/test setup.

## Release Workflow

1. Plan versions: `pnpm release:plan`
2. Review version plans in `.nx/version-plans/`
3. Run release: `pnpm nx release`
4. CI will verify tarballs and publish to npm

For details, see the [release workflow](.github/workflows/release.yml).

## License

MIT
