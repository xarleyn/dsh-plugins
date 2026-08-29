# SPEC: DeepSeek Harness Plugins Monorepo

**Status:** Draft  
**Target:** Consolidate multiple DeepSeek Harness plugins into a single maintainable monorepo  
**Primary tooling:** pnpm workspaces + Nx  
**Distribution:** npm packages + GitHub Releases (`.tgz`)  
**Versioning model:** Independent package versions

---

## 1. Purpose

Create a clean, scalable monorepo for multiple DeepSeek Harness (DSH) plugins with:

- a single repository for all plugins and shared libraries;
- centralized dependency management;
- minimal duplication of installed dependencies;
- reusable shared code without copy-paste;
- isolated package boundaries between plugins;
- fast CI that only checks affected projects;
- independent plugin versioning;
- low-friction releases;
- automatic changelogs, Git tags, npm publication, and GitHub Releases;
- release artifacts that can also be installed as `.tgz`;
- an easy path for generating new plugins from a standard template.

The monorepo must preserve each plugin as an independent npm package rather than merging all plugins into one package.

---

## 2. Architectural decision

Use:

- **pnpm workspaces** as the package/dependency layer;
- **Nx** as the project graph, task orchestration, affected-build, caching, and release layer.

Nx must not replace pnpm.

### Responsibility split

| Concern | Tool |
|---|---|
| Dependency installation | pnpm |
| Workspace package linking | pnpm |
| Shared lockfile | pnpm |
| Shared pnpm virtual store | pnpm |
| Central dependency versions | pnpm catalogs |
| Internal workspace dependency ranges | `workspace:` protocol |
| Project graph | Nx |
| Affected build/test/lint | Nx |
| Task caching | Nx |
| Release planning | Nx Release |
| Independent versioning | Nx Release |
| Changelog generation | Nx Release |
| Git tags | Nx Release |
| npm publication orchestration | Nx Release |
| GitHub Releases | Nx Release / GitHub Actions |

---

## 3. Repository layout

Recommended structure:

```text
dsh-plugins/
├─ plugins/
│  ├─ dsh-draft-sessions/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  └─ client.ts
│  │  ├─ tests/
│  │  ├─ cordis.patch.yml
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ README.md
│  │
│  ├─ session-pin/
│  ├─ notification/
│  ├─ ui-tweaks/
│  └─ ...
│
├─ packages/
│  ├─ plugin-kit/
│  ├─ ui-kit/
│  ├─ test-kit/
│  └─ config/
│
├─ tooling/
│  ├─ generators/
│  ├─ scripts/
│  └─ release/
│
├─ .nx/
│  └─ version-plans/
│
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ release.yml
│
├─ nx.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ package.json
├─ tsconfig.base.json
└─ README.md
```

---

## 4. Package boundaries

Every DSH plugin must remain its own npm package.

Example:

```text
@yadsh/dsh-draft-sessions
@yadsh/dsh-session-pin
@yadsh/dsh-notification
@yadsh/dsh-ui-tweaks
```

Shared libraries must also be separate workspace packages, for example:

```text
@yadsh/dsh-plugin-kit
@yadsh/dsh-ui-kit
@yadsh/dsh-test-kit
@yadsh/dsh-config
```

Shared libraries are not DSH bundles unless explicitly needed.

A normal shared package must not contain `dsh.bundle`.

A DSH plugin package must define its bundle entry metadata, for example:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

---

## 5. Dependency architecture

### 5.1 DSH runtime dependencies

Framework/runtime dependencies supplied by DeepSeek Harness should normally be declared as `peerDependencies`.

Example:

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

Rationale:

- `peerDependencies` means the plugin expects the Harness runtime to provide the compatible framework instance;
- `devDependencies` makes the dependency available for local typecheck, tests, and builds;
- this avoids accidentally bundling or loading multiple incompatible Cordis/DSH runtime instances.

Do not place shared DSH runtime/framework packages in normal `dependencies` unless there is a specific reason.

### 5.2 Internal libraries

Use pnpm's workspace protocol for internal packages.

Example:

```json
{
  "dependencies": {
    "@yadsh/dsh-plugin-kit": "workspace:^"
  }
}
```

During publish/pack, pnpm should convert the workspace reference to an ordinary semver range.

### 5.3 Shared library direction

Preferred dependency direction:

```text
DSH runtime/API
      ▲
      │ peer
plugin-kit / ui-kit
      ▲
      │
 ┌────┼───────────────┐
 │    │               │
plugin A          plugin B          plugin C
```

Avoid plugin-to-plugin coupling unless the dependency represents a deliberate extension API.

Do not create cycles such as:

```text
plugin A -> plugin B -> plugin C -> plugin A
```

### 5.4 No generic `shared` dump package

Do not create a single package such as:

```text
packages/shared
```

that accumulates unrelated helpers.

Prefer capability-oriented packages:

```text
packages/plugin-kit
packages/ui-kit
packages/test-kit
packages/config
```

---

## 6. pnpm workspace configuration

Recommended baseline:

```yaml
packages:
  - plugins/*
  - packages/*

linkWorkspacePackages: false

disallowWorkspaceCycles: true

nodeLinker: isolated

catalogs:
  dsh:
    '@deepseek-ai/cordis': '<compatible-range>'
    '@deepseek-ai/dsh-tools': '<compatible-range>'
    '@deepseek-ai/dsh-settings': '<compatible-range>'

  tooling:
    typescript: '<version>'
    vitest: '<version>'
    tsdown: '<version>'
    nx: '<version>'
```

Exact dependency names/ranges should be aligned with the currently supported DeepSeek Harness version.

---

## 7. `node_modules` strategy

### Development monorepo

Use:

```yaml
nodeLinker: isolated
```

This preserves strict package boundaries and catches phantom dependencies.

A plugin must not accidentally work only because another workspace package installed a dependency into a shared flat tree.

pnpm will still use a shared content-addressed/virtual store, so packages do not require full duplicate physical copies of every dependency.

Expected shape:

```text
repo/
├─ node_modules/
│  └─ .pnpm/
│     ├─ dependency-a@...
│     ├─ dependency-b@...
│     └─ ...
│
├─ plugins/
│  ├─ plugin-a/
│  │  └─ node_modules/   # links
│  └─ plugin-b/
│     └─ node_modules/   # links
```

### Installed DSH profile

Do not implement a custom global dependency loader.

DeepSeek Harness itself can manage installed external plugins within a profile and use hoisted dependency resolution where appropriate.

The monorepo should therefore optimize for correctness during development rather than attempting to reproduce DSH's runtime package layout.

---

## 8. pnpm catalogs

Use catalogs to centralize versions that should be consistent across plugins.

Example:

```yaml
catalogs:
  dsh:
    '@deepseek-ai/cordis': '^x.y.z'

  tooling:
    typescript: '^x.y.z'
    vitest: '^x.y.z'
```

Then packages can use:

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

- one place to update compatible DSH ranges;
- no version drift across plugins;
- easier upgrades;
- cleaner diffs.

---

## 9. Standard plugin package

Recommended baseline `package.json`:

```json
{
  "name": "@yadsh/dsh-example-plugin",
  "version": "0.1.0",
  "description": "Example DeepSeek Harness plugin",
  "type": "module",

  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",

  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    }
  },

  "files": [
    "lib",
    "cordis.patch.yml",
    "README.md"
  ],

  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },

  "dependencies": {
    "@yadsh/dsh-plugin-kit": "workspace:^"
  },

  "peerDependencies": {
    "@deepseek-ai/cordis": "catalog:dsh"
  },

  "devDependencies": {
    "@deepseek-ai/cordis": "catalog:dsh"
  },

  "publishConfig": {
    "access": "public"
  },

  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Remove the `./client` export when a plugin has no client-side entrypoint.

---

## 10. Build strategy

Each publishable package must have an explicit build target.

Recommended tooling:

- TypeScript;
- `tsdown` or equivalent lightweight bundler/compiler;
- Vitest;
- `tsc --noEmit` for type checking.

Build output should go to:

```text
lib/
```

Source code must not be required at runtime for ordinary npm/tarball installation.

The published package should contain only runtime-required files.

Example:

```text
package.tgz
├─ package.json
├─ README.md
├─ cordis.patch.yml
└─ lib/
   ├─ index.js
   ├─ client.js
   └─ types/
```

---

## 11. Nx usage

Nx should be used as a thin orchestration layer.

Required capabilities:

- project graph;
- `affected` target execution;
- task caching;
- release planning;
- independent versioning;
- changelog generation;
- dependency-aware version bumps;
- Git tags;
- GitHub Releases;
- publish orchestration.

Do not introduce Nx-specific complexity into plugin source code.

Plugins should remain ordinary npm packages that can be built outside Nx if necessary.

---

## 12. Independent versioning

Plugins must not share a single repository-wide version.

Example:

```text
@yadsh/dsh-draft-sessions@1.4.2
@yadsh/dsh-ui-tweaks@0.7.1
@yadsh/dsh-notification@2.1.0
```

Recommended Nx setting:

```json
{
  "release": {
    "projectsRelationship": "independent"
  }
}
```

Changing one plugin must not automatically bump unrelated plugin versions.

Shared internal libraries may have independent versions as well.

---

## 13. Nx Version Plans

Use file-based version plans.

Developer workflow:

```bash
pnpm nx release plan
```

Example generated plan:

```yaml
---
"@yadsh/dsh-draft-sessions": minor
---

Add session folder support.
```

Store plans under:

```text
.nx/version-plans/
```

CI should validate that publishable changes include a version plan.

Example:

```bash
pnpm nx release plan:check
```

This makes version intent explicit in the PR instead of deriving all release semantics only from commit-message conventions.

---

## 14. Nx release configuration

Recommended direction:

```json
{
  "release": {
    "projects": [
      "plugins/*",
      "packages/plugin-kit",
      "packages/ui-kit"
    ],

    "projectsRelationship": "independent",

    "versionPlans": true,

    "version": {
      "updateDependents": "always"
    },

    "releaseTag": {
      "pattern": "{projectName}@{version}"
    },

    "changelog": {
      "projectChangelogs": {
        "createRelease": "github"
      }
    }
  }
}
```

Exact syntax must be verified against the Nx version selected during implementation.

---

## 15. Release artifacts

npm should be the primary distribution channel.

Each plugin should also produce a `.tgz` package artifact for GitHub Releases.

Target release flow:

```text
source
  ↓
build
  ↓
test
  ↓
pnpm pack
  ↓
verify tarball
  ↓
npm publish
  ↓
Git tag
  ↓
GitHub Release
  ↓
attach .tgz
```

Do not make installation directly from a Git repository the primary distribution model.

A prebuilt npm package or `.tgz` avoids unnecessary source builds on the user's DSH instance.

---

## 16. Release verification

Never publish a package solely because the workspace source tree passes tests.

CI must verify the actual packed package.

Required release gate:

```text
lint
  ↓
typecheck
  ↓
unit tests
  ↓
build
  ↓
pnpm pack
  ↓
extract/inspect .tgz
  ↓
verify package.json
  ↓
verify required bundle files
  ↓
verify exports
  ↓
install .tgz into temporary environment/profile
  ↓
smoke-test plugin loading
```

At minimum, verification should ensure:

- `lib/` exists;
- `package.json` has correct `name` and `version`;
- DSH bundle metadata is present for plugins;
- `cordis.patch.yml` is included when required;
- exported entrypoints exist;
- no source-only internal workspace references remain;
- no `workspace:` or `catalog:` protocol leaks into a form unsupported by consumers;
- package can be installed from the tarball;
- plugin can initialize in a minimal DSH-compatible smoke test.

---

## 17. CI workflow

File:

```text
.github/workflows/ci.yml
```

PR pipeline:

```bash
pnpm install --frozen-lockfile

pnpm nx affected -t lint
pnpm nx affected -t typecheck
pnpm nx affected -t test
pnpm nx affected -t build

pnpm nx release plan:check
```

CI should use Nx affected calculation so that a change to one plugin does not rebuild every package unnecessarily.

Where useful, CI can also run tarball verification only for affected publishable packages.

---

## 18. Release workflow

File:

```text
.github/workflows/release.yml
```

Initial implementation should use manual:

```yaml
workflow_dispatch:
```

Recommended flow:

```text
Manual release trigger
        ↓
checkout
        ↓
pnpm install --frozen-lockfile
        ↓
release gates
        ↓
apply Nx Version Plans
        ↓
calculate independent versions
        ↓
update dependency ranges
        ↓
generate changelogs
        ↓
build affected release packages
        ↓
pack and verify
        ↓
publish to npm
        ↓
commit version/changelog changes
        ↓
create Git tags
        ↓
create GitHub Releases
        ↓
attach .tgz artifacts
```

A later iteration may automate release execution after merge once the pipeline has proven reliable.

---

## 19. npm authentication

Prefer npm Trusted Publishing / GitHub Actions OIDC over long-lived `NPM_TOKEN` secrets where supported.

Release workflow should request only the permissions it requires.

Expected GitHub Actions permission direction:

```yaml
permissions:
  contents: write
  id-token: write
```

Use npm provenance where supported.

Do not store broad, long-lived npm publish tokens unless OIDC cannot be used.

---

## 20. Git tags and GitHub Releases

Because package versions are independent, tags should include package identity.

Preferred pattern:

```text
@yadsh/dsh-draft-sessions@1.4.2
@yadsh/dsh-ui-tweaks@0.7.1
```

GitHub Releases should be generated per independently released package.

Each GitHub Release should ideally include:

- package name;
- version;
- generated changelog;
- installation command;
- `.tgz` release asset.

---

## 21. New plugin generator

Implement a custom Nx generator or repository script.

Target command:

```bash
pnpm nx g dsh-plugin foo
```

Expected output:

```text
plugins/foo/
├─ src/
│  └─ index.ts
├─ tests/
├─ cordis.patch.yml
├─ package.json
├─ tsconfig.json
└─ README.md
```

Optional flags:

```text
--client
--description
--scope
--with-ui
--with-tests
```

Generator responsibilities:

- create standard package metadata;
- create DSH bundle metadata;
- add catalog-based DSH peer/dev dependencies;
- configure build/test/typecheck targets;
- add optional client entrypoint;
- create starter README;
- create starter tests;
- enforce repository naming conventions.

The generator should make adding a new plugin a near-zero-boilerplate operation.

---

## 22. Repository-level scripts

Root `package.json` should provide convenient commands such as:

```json
{
  "scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "typecheck": "nx run-many -t typecheck",
    "lint": "nx run-many -t lint",

    "affected:build": "nx affected -t build",
    "affected:test": "nx affected -t test",
    "affected:check": "nx affected -t lint,typecheck,test,build",

    "release:plan": "nx release plan",
    "release:check": "nx release plan:check"
  }
}
```

Exact scripts may be adjusted to Nx CLI behavior in the selected version.

---

## 23. Configuration package

Repository-wide TypeScript, Vitest, build, and lint configuration should be centralized.

Example:

```text
packages/config/
├─ tsconfig/
│  ├─ base.json
│  ├─ node.json
│  └─ browser.json
├─ vitest/
└─ build/
```

Avoid copying large configuration blocks into every plugin.

Package-level configs should extend repository presets.

---

## 24. Test kit

`packages/test-kit` should provide common DSH plugin testing utilities.

Possible responsibilities:

- mocked Cordis/DSH context;
- plugin lifecycle helpers;
- fixture profile generation;
- temporary package/profile installation;
- client/server test utilities;
- common assertions;
- tarball smoke-test helpers.

This package should be development-only for most plugins.

---

## 25. Plugin kit

`packages/plugin-kit` may contain common runtime helpers such as:

- configuration helpers;
- structured logging helpers;
- shared lifecycle wrappers;
- compatibility checks;
- safe feature detection;
- common DSH service access helpers;
- small reusable utilities directly related to plugin runtime.

It must not become an unrestricted utility dump.

---

## 26. UI kit

Create `packages/ui-kit` only if multiple plugins genuinely reuse UI primitives.

Possible contents:

- shared client-side utilities;
- common controls;
- modal/layout helpers;
- DSH-specific UI integration helpers.

Do not force plugins to depend on a UI package when there is no shared UI requirement.

---

## 27. Dependency rules

The implementation should enforce the following:

1. Plugins may depend on shared packages.
2. Shared packages must not depend on concrete plugins.
3. Runtime DSH framework packages should normally be peers.
4. `test-kit` must not become a runtime dependency.
5. Cyclic workspace dependencies are forbidden.
6. A plugin must explicitly declare every package it imports.
7. Do not rely on hoisting to satisfy undeclared dependencies.
8. Prefer public interfaces over imports from another package's internal source paths.
9. Do not import another package via paths such as:

```text
../../other-plugin/src/...
```

10. Internal package consumption must happen through declared package exports.

---

## 28. Package naming conventions

Recommended naming:

```text
@yadsh/dsh-<plugin-name>
```

Shared packages:

```text
@yadsh/dsh-plugin-kit
@yadsh/dsh-ui-kit
@yadsh/dsh-test-kit
@yadsh/dsh-config
```

Directory names may omit the `dsh-` prefix:

```text
plugins/dsh-draft-sessions
plugins/session-pin
packages/plugin-kit
```

The npm package name remains explicit.

---

## 29. README conventions

Every plugin README should contain at least:

```text
# Plugin name

Short description.

## Features

## Requirements

## Installation

npm:
dsh plugin add @yadsh/dsh-plugin-name

Tarball:
dsh plugin add ./package.tgz

## Configuration

## Compatibility

## Development

## License
```

Repository root README should contain:

- project overview;
- plugin catalog;
- workspace architecture;
- development setup;
- adding a new plugin;
- release workflow.

---

## 30. Compatibility policy

The repo should define a clear supported DeepSeek Harness version policy.

For example:

```text
Supported DSH:
>= X.Y < Z
```

Compatible runtime ranges should be centralized in pnpm catalogs.

If multiple major DSH versions require incompatible behavior, use explicit compatibility helpers rather than silent runtime assumptions.

---

## 31. Release safety

Release workflow must prevent:

- publishing dirty/unbuilt source;
- duplicate version publication;
- publication without successful tests;
- publication of packages with broken exports;
- publication of tarballs missing DSH metadata;
- accidental publication of private/dev-only packages;
- leaking local workspace paths into the package;
- accidental release of every plugin when only one changed.

Private packages must explicitly contain:

```json
{
  "private": true
}
```

and must be excluded from release configuration.

---

## 32. Non-goals

This architecture does not attempt to:

- merge all plugins into one runtime package;
- implement a custom package manager;
- replace pnpm with Nx;
- build a custom shared `node_modules` loader;
- bypass npm package boundaries;
- make plugins directly import one another's source trees;
- force synchronized versions across all plugins.

---

## 33. Implementation phases

### Phase 1 — Monorepo foundation

- create root pnpm workspace;
- add Nx;
- create root TypeScript config;
- create catalogs;
- migrate existing plugins into `plugins/*`;
- create shared package conventions;
- establish package naming.

### Phase 2 — Build and test normalization

- standardize build output;
- standardize package exports;
- standardize DSH metadata;
- add common test setup;
- migrate common helpers into capability packages.

### Phase 3 — CI

- add affected lint/typecheck/test/build;
- add workspace dependency checks;
- add release-plan validation;
- add package/tarball smoke verification.

### Phase 4 — Release automation

- configure independent Nx releases;
- configure version plans;
- generate changelogs;
- create per-package Git tags;
- publish to npm;
- create GitHub Releases;
- attach `.tgz` artifacts;
- configure npm Trusted Publishing/OIDC.

### Phase 5 — Developer experience

- add `dsh-plugin` generator;
- add repository scripts;
- improve README and contribution docs;
- optionally add migration/generator utilities for existing standalone plugin repositories.

---

## 34. Acceptance criteria

The implementation is complete when all of the following are true:

- [ ] All plugins live in one Git repository.
- [ ] Each plugin remains an independently installable npm package.
- [ ] One root `pnpm-lock.yaml` is used.
- [ ] pnpm workspace dependency resolution works.
- [ ] `nodeLinker: isolated` is used in the development monorepo.
- [ ] Common DSH runtime dependencies are centrally versioned.
- [ ] DSH framework/runtime packages are peers where appropriate.
- [ ] Internal packages use `workspace:` references.
- [ ] No plugin relies on undeclared phantom dependencies.
- [ ] Workspace cycles are rejected.
- [ ] Nx can build/test/typecheck only affected packages.
- [ ] Each plugin can have an independent version.
- [ ] Release intent can be declared using Nx Version Plans.
- [ ] CI verifies version plans where appropriate.
- [ ] Release pipeline generates changelogs and Git tags.
- [ ] Release pipeline can publish affected packages to npm.
- [ ] GitHub Releases are generated per released plugin.
- [ ] `.tgz` artifacts are attached to releases.
- [ ] Packed tarballs are smoke-tested before publication.
- [ ] npm publication uses OIDC/Trusted Publishing if supported.
- [ ] New plugins can be scaffolded via a standard generator.
- [ ] Shared code is split by capability rather than accumulated into one generic package.

---

## 35. Final target state

The final repository should behave approximately like this:

```text
                         Git repository
                              │
                    ┌─────────▼─────────┐
                    │  pnpm workspace   │
                    │                  │
                    │ lockfile         │
                    │ catalogs         │
                    │ workspace:^      │
                    │ shared .pnpm     │
                    └─────────┬─────────┘
                              │
                ┌─────────────▼─────────────┐
                │            Nx             │
                │                           │
                │ project graph             │
                │ affected                  │
                │ cache                     │
                │ version plans             │
                │ independent releases      │
                └─────────────┬─────────────┘
                              │
          ┌───────────────────┼────────────────────┐
          │                   │                    │
     plugin/foo          plugin/bar        packages/plugin-kit
          │                   │                    │
          └──────────────┬────┴────────────────────┘
                         │
                       build
                         │
                       pack
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
             npm              GitHub Release
                                   │
                                 *.tgz
```

The core principle is:

> **Unify repository, tooling, dependencies, CI and release infrastructure — not plugin package boundaries.**

pnpm owns the workspace and dependency model. Nx sits above it to provide project-aware orchestration and release automation.
