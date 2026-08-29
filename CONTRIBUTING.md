# Contributing to DSH Plugins Monorepo

Thank you for your interest in contributing! This document covers the workflow, conventions, and expectations for contributing to this monorepo.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Adding a New Plugin](#adding-a-new-plugin)
- [Adding a Shared Package](#adding-a-shared-package)
- [Making Changes](#making-changes)
- [Commit Convention](#commit-convention)
- [Release Process](#release-process)
- [Code of Conduct](#code-of-conduct)

---

## Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd dsh-plugins

# Install dependencies
pnpm install

# Verify setup
pnpm build
pnpm test
pnpm typecheck
```

### Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10.4
- **Git**

---

## Development Workflow

### Recommended Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint repository tooling and all packages |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check all packages |
| `pnpm check` | Run the complete local validation pipeline |
| `pnpm deps:check` | Enforce workspace dependency boundaries |
| `pnpm tarball:verify` | Pack, install, and smoke-test publishable packages |
| `pnpm affected:check` | Run lint/typecheck/test/build on affected packages only |
| `pnpm release:plan` | Start version planning for next release |
| `pnpm release:check` | Validate version plans exist |

### Affected Builds

Nx automatically calculates which packages are affected by your changes. Use `pnpm affected:check` to run the full pipeline only on changed packages — this is significantly faster than running everything.

---

## Adding a New Plugin

The fastest way to add a new plugin is with the built-in generator:

```bash
pnpm nx g dsh-plugin <name> --client --description "My awesome plugin"
```

### Available Flags

| Flag | Description |
|------|-------------|
| `--client` | Include a client-side entrypoint (`src/client.ts`) |
| `--description` | Short description for the plugin |
| `--scope` | npm scope (default: `@yadsh`) |
| `--with-ui` | Use an existing shared UI kit; fails clearly while no UI contract exists |
| `--with-tests=false` | Omit starter tests and the Vitest target |

### What the Generator Creates

```
plugins/<name>/
├── src/
│   ├── index.ts          # Server-side entrypoint
│   └── client.ts         # Client-side (if --client)
├── tests/
│   └── index.test.ts     # Starter tests
├── cordis.patch.yml      # DSH bundle metadata
├── LICENSE               # Repository MIT license copy
├── package.json          # Standardized metadata
├── tsconfig.json         # Extends the shared config package
├── vitest.config.ts      # Test configuration
└── README.md             # Plugin documentation
```

### Manual Plugin Creation

If you prefer to create a plugin manually, follow the [SPEC §9](./dsh-plugins-monorepo-SPEC.md#9-standard-plugin-package) specification for package structure and metadata.

---

## Adding a Shared Package

Shared packages live in `packages/` and are organized by capability:

| Package | Purpose |
|---------|---------|
| `plugin-kit` | Runtime helpers (logger, config validation, version checks) |
| `test-kit` | Testing utilities (mock contexts, fixtures) |
| `config` | Shared TypeScript, Vitest, and build configs |
| `ui-kit` | Shared UI primitives (when needed by multiple plugins) |

### Guidelines

1. **Name by capability**, not by function (`plugin-kit`, not `helpers`)
2. **No plugin-to-plugin coupling** — shared packages must not depend on concrete plugins
3. **Use `workspace:^`** for internal dependencies
4. **Declare DSH runtime deps as `peerDependencies`** with `catalog:dsh`

### Example: Adding a New Shared Package

```bash
mkdir -p packages/my-capability/src
# Copy package.json template from packages/plugin-kit
# Adjust name, exports, and dependencies
pnpm install
pnpm build my-capability
```

---

## Making Changes

### Before Submitting

1. **Run the full affected check:**
   ```bash
   pnpm affected:check
   ```

2. **Verify tarball verification passes** (for publishable packages):
   ```bash
   bash scripts/tarball-verify.sh plugins/your-plugin
   ```

3. **Check dependency rules:**
   ```bash
   bash scripts/check-dependencies.sh
   ```

### Dependency Rules (SPEC §27)

These are enforced automatically by CI, but know them before writing code:

1. Plugins may depend on shared packages — ✅
2. Shared packages must NOT depend on concrete plugins — ❌
3. DSH runtime packages should be `peerDependencies`, not `dependencies` — ⚠️
4. `test-kit` must only appear in `devDependencies` — ⚠️
5. No cyclic workspace dependencies — 🔒
6. Every import must be declared in a dependency field — ✅
7. Do not rely on hoisting for undeclared dependencies — ⚠️
8. Prefer public interfaces over deep source imports (`../other/src/...`) — ❌
9. Workspace consumption must go through declared package exports — ✅

---

## Commit Convention

This repository uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

### Types

| Type | When to Use |
|------|-------------|
| `feat` | New feature or plugin |
| `fix` | Bug fix |
| `docs` | Documentation changes only |
| `chore` | Tooling, config, releases |
| `refactor` | Code refactoring (no behavior change) |
| `test` | Adding or updating tests |
| `ci` | CI/CD workflow changes |

### Examples

```bash
feat(dsh-draft-sessions): add auto-save with configurable interval
fix(plugin-kit): fix version comparison for pre-release strings
chore: update pnpm to 10.4.1
docs: add CONTRIBUTING.md
```

---

## Release Process

### For Contributors

1. When your PR includes publishable changes, run:
   ```bash
   pnpm release:plan
   ```
2. This creates a version plan in `.nx/version-plans/`
3. CI will fail if you push to `main` without a version plan

### For Maintainers

1. Review and approve all version plans
2. Trigger the release workflow manually:
   ```bash
   # In GitHub Actions → Release → Run workflow
   ```
3. Keep `dry_run=true` and inspect the complete Nx release preview
4. Run again with `dry_run=false`; Version Plans determine all bump types
5. Use `first_release=true` only while no package release tags exist

### Version Plan Format

Plans are Markdown files with YAML front matter in `.nx/version-plans/`:

```yaml
---
"@yadsh/dsh-draft-sessions": minor
---

Add session folder support.
```

Use `pnpm nx release plan` to interactively select packages and bump types.
See [docs/RELEASING.md](./docs/RELEASING.md) for maintainer setup and recovery procedures.

---

## Code Review Expectations

- **PRs should be focused** — one plugin or shared package per PR when possible
- **Affected builds must pass** — CI uses Nx affected calculation
- **Version plans are required** for publishable changes on `main`
- **Tarball verification is a gate** — failed verification blocks the release

---

## Questions?

- Check the [SPEC](./dsh-plugins-monorepo-SPEC.md) for architectural decisions
- See [docs/COMPATIBILITY.md](./docs/COMPATIBILITY.md) for DSH version compatibility
- Open an issue for questions or suggestions

---

*Thank you for contributing to the DeepSeek Harness plugin ecosystem!*
