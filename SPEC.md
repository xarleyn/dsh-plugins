# SPEC: DeepSeek Harness Plugins Monorepo

**Status:** Draft  
**Target:** Consolidate multiple DeepSeek Harness plugins into a single maintainable monorepo  
**Primary tooling:** pnpm workspaces + Nx  
**Distribution:** npm packages + GitHub Releases (`.tgz`)  
**Versioning model:** Independent package versions

---

## Document precedence

This SPEC is the architecture brief the monorepo was built to. It stays `Draft` because it records intent rather than the operating procedure, and a command read here is no evidence that the command runs. Where this file and the repository disagree, the repository wins, in this order:

1. **What actually runs** — the scripts in `package.json`, the release configuration in `nx.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` and `scripts/`. A check that is not in that set is not a gate.
2. **The runbooks** — [docs/RELEASING.md](docs/RELEASING.md) for the release procedure and [docs/VERIFICATION.md](docs/VERIFICATION.md) for what each gate asserts. Both are maintained against the code.
3. **This SPEC** — the target architecture and the reasoning behind it.
4. **[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md)** — the contributor-facing restatements of 1–3.

Two release decisions postdate this document, and the release sections now state them: a release run publishes a wave and marks it with one `release/<date>` tag and one GitHub Release, and the version-plan gate is the repository's own `scripts/check-release-plans.mjs` rather than Nx's `release plan:check`. The sections that carry those decisions are §2, §3, §11–§22 and the phase and acceptance lines of §33 and §34; they still name the older scheme where its shape is legible, and §20 records how much of it is left to read — a tag census that comes back empty.

The precedence above is a statement, not a mechanism. `scripts/repo-config.test.mjs` compares the three blocks this file copies verbatim — the `release` configuration of §14, the `prepare` gate list of §17 and the command excerpt of §22 — against `nx.json`, `.github/workflows/ci.yml` and `package.json`, re-runs §20's tag census against the remotes this checkout points at, and CI runs all of it as part of `pnpm test:release`. A change to any of those files that leaves the copies behind fails a gate rather than quietly turning this Draft into a description of a release nobody runs.

---

## 1. Purpose

Create a clean, scalable monorepo for multiple DeepSeek Harness (DSH) plugins with:

- a single repository for all plugins and shared libraries;
- centralized dependency management;
- minimal duplication of installed dependencies;
- reusable shared code without copy-paste;
- isolated package boundaries between plugins;
- fast CI that checks the affected projects of a pull request, and the whole workspace of a push (§17);
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
| Release planning (version plans) | Nx Release |
| Release versioning and changelogs | Nx Release (`nx release --skip-publish`) |
| Version-plan gate | `scripts/check-release-plans.mjs` (`pnpm release:check`) |
| npm publication orchestration | `scripts/publish-release.mjs`, driven by the release workflow through npm OIDC |
| Git tags | the release workflow — one `release/<date>` wave tag per run (§20) |
| GitHub Releases | the release workflow — one Release per wave (§20) |

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
│  └─ generators/
│
├─ scripts/
│  ├─ check-release-plans.mjs
│  ├─ publish-release.mjs
│  ├─ wave-release-notes.mjs
│  ├─ tarball-verify.sh
│  └─ …
│
├─ docs/
│  ├─ RELEASING.md
│  ├─ VERIFICATION.md
│  └─ …
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

The tree is the shape of the repository, not an inventory: `scripts/` and `docs/` list the files a release run reads, and both directories hold more (§22 quotes the root manifest, which is where the repository's commands are declared, and [docs/VERIFICATION.md](docs/VERIFICATION.md#gate-map) lists every gate that runs).

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

A deliberate extension API is a piece of the provider's own feature surface that
it publishes for other plugins to mount into — a panel slot, a settings page, a
Remote client, a service face — and documents as a supported consumer contract.
Such a dependency is allowed when every one of these holds:

- The provider exports the surface through its declared `exports` map (§27.10);
  imports from its sources stay forbidden (§27.8).
- The provider documents the surface in its README/SPEC as supported and keeps it
  backward compatible: reshaping it is a major bump of the provider, and its
  version plan names the consuming plugins.
- The consumer declares the dependency in its own manifest (§27.6) and, for a
  client surface, lists the provider in `dsh.client.inject` so the loader brings
  the provider up before its bundle applies.
- The graph stays acyclic (§27.5), and the surface stays feature-specific. Code
  that is genuinely general belongs in `packages/*`: a plugin others must
  install is not a shared library.

The sanctioned edges live in the allowlist of
[`docs/PLUGIN_GUIDELINES.md`](./docs/PLUGIN_GUIDELINES.md#31-границы-монорепо-и-зависимости);
a new edge is added to that list by the same change that introduces it.

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
- version application, on the release commit (`nx release --skip-publish`).

Dependents are not versioned with their bases (§14), so Nx does no dependency-aware bump here. Tagging, npm publication and the GitHub Release are steps of `.github/workflows/release.yml`, not of Nx (§14, §20).

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
pnpm release:plan
```

`release:plan` is `nx release plan` (the *Release planning (version plans)* row of §2). Example generated plan:

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

A plan file must open with its `---` front-matter fence, because Nx silently ignores a plan it cannot parse. Two gates hold that rule, and they fail differently. `pnpm verify:packages` (`scripts/verify-package-hygiene.mjs`) reproduces Nx's parsing rules and rejects the file by name; the release workflow runs that same check — `node scripts/verify-package-hygiene.mjs --version-plans-only` — before it versions anything. `pnpm release:check` instead reads a plan exactly the way Nx does, so a file without the fence is skipped there rather than reported, and it fails one step later: the project that file was written for is named by no plan at all.

CI validates that publishable changes include a version plan:

```bash
pnpm release:check --base="$NX_BASE" --head="$NX_HEAD"
```

`release:check` is `node scripts/check-release-plans.mjs`, not `nx release plan:check`. Nx compares one `base..head` range the same way for every project, so on a branch that ran its own release it reports the published work as unreleased and demands plans that release already consumed and deleted; the repository's gate instead anchors each project on the newest release tag its history can reach (§20) and ignores the paths Nx ignores for this decision (`release.versionPlans.ignorePatternsForPlanCheck`). The same command runs locally and in CI, which is what keeps the two answers identical.

This makes version intent explicit in the PR instead of deriving all release semantics only from commit-message conventions.

The contributor procedure and the gate's semantics are owned by [docs/RELEASING.md](docs/RELEASING.md#contributor-flow) and the Version plans row of [docs/VERIFICATION.md](docs/VERIFICATION.md#gate-map).

---

## 14. Nx release configuration

Shipped configuration, as `release` in `nx.json`:

```json
{
  "release": {
    "projects": [
      "plugins/*",
      "packages/plugin-log",
      "packages/plugin-kit",
      "packages/audit-core",
      "packages/audit-ui"
    ],

    "projectsRelationship": "independent",

    "versionPlans": {
      "ignorePatternsForPlanCheck": ["**/CHANGELOG.md", "**/package.json"]
    },

    "version": {
      "updateDependents": "never"
    },

    "git": {
      "tag": false
    },

    "releaseTag": {
      "pattern": "{projectName}@{version}"
    },

    "changelog": {
      "workspaceChangelog": false,
      "projectChangelogs": true
    }
  }
}
```

Dependents are not versioned with their bases: every workspace range is a caret, so a minor or patch release of a base resolves without republishing the plugins that depend on it, and a release wave carries only the packages whose code actually changed. A major release of a base needs explicit version plans for its dependents in the same change.

`Nx Release` versions and writes changelogs and nothing else (`git.tag: false`, `changelog.projectChangelogs: true` with no `createRelease`). The release workflow runs `nx release --skip-publish`, then publishes to npm itself and creates the wave tag and the GitHub Release (§20) — publishing first is what makes a pushed tag mean something.

`releaseTag.pattern` describes the per-package tag shape, which a release run no longer creates and which no tag in this repository still carries (§20). Three paths read that shape as a fallback rather than as the target — the plan gate, the `publish_only` proof and the GitHub Release step — and on the current history each of them resolves to no tag at all (§20). The pattern is the shape of past releases, not of a new one; do not mint tags in it.

The syntax above is the one the pinned Nx accepts — `nx` in the `tooling` catalog of `pnpm-workspace.yaml`, checked with `pnpm nx release --help`.

The registry preflight and the publish-then-tag order are [docs/RELEASING.md](docs/RELEASING.md#maintainer-flow); how a plan is read and why a malformed one is rejected is [docs/RELEASING.md](docs/RELEASING.md#contributor-flow).

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
one wave tag (release/<date>)
  ↓
one GitHub Release for the wave
  ↓
attach every .tgz of the wave
```

Do not make installation directly from a Git repository the primary distribution model.

A prebuilt npm package or `.tgz` avoids unnecessary source builds on the user's DSH instance.

The shipped run of this flow, with the pre-publication registry check and the install-from-registry check that sit between publish and tag, is [docs/RELEASING.md](docs/RELEASING.md#maintainer-flow).

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

[docs/VERIFICATION.md](docs/VERIFICATION.md#gate-map) names the command behind each of these checks — `pnpm verify:packages` for the manifest and content rules, the per-project `verify` target for the built package, `pnpm tarball:verify` for packing and the clean-room install.

---

## 17. CI workflow

File:

```text
.github/workflows/ci.yml
```

The run has one `prepare` job of repository-wide checks, then one job per selected project:

```bash
# prepare — workspace-wide gates, run once
pnpm install --frozen-lockfile
pnpm deps:check
pnpm lint:workspace
pnpm format
pnpm check:files
pnpm verify:logging
pnpm verify:a11y
pnpm verify:testids
pnpm verify:packages
pnpm test:release
pnpm release:check --base="$NX_BASE" --head="$NX_HEAD"

# projects — one runner per selected project
pnpm nx run-many -t lint typecheck test build verify --projects="$NX_PROJECT" --output-style=static
pnpm check:files                                    # the build output now exists to measure
pnpm tarball:verify:packages "$PACKAGE_DIRECTORY"   # every publishable project
```

The `prepare` half is the workflow's own step list, and `scripts/repo-config.test.mjs` compares them command for command against `.github/workflows/ci.yml`; the project half names the gates that run per selected project rather than every step that job runs.

Tarball verification is not something CI reaches for where useful — it is a condition on the matrix row: every project `publishable` covers packs its tarball and installs that tarball in a clean environment, so no package can ship from a run that only read its source tree (§16). `pnpm check:files` runs a second time here for the opposite reason: the `prepare` checkout has no build output, so the generated-bundle band of the size budget measures nothing until this project has been built.

Affected calculation picks the projects, not the targets: a pull request runs `pnpm nx show projects --affected --base="$NX_BASE" --head="$NX_HEAD" --json` and verifies those, so a change to one plugin does not rebuild every package unnecessarily. A push is the verification of the branch itself, so it takes the whole workspace — selecting a push by `--affected` would silently drop a project the previous run never reached.

A third job, `Verify projects`, runs nothing of its own — it only reads the results of `prepare` and the project matrix, so branch protection has one context to require.

The command list and what each gate asserts is [docs/VERIFICATION.md](docs/VERIFICATION.md#local-one-shot); the reason `pnpm release:check` runs on both events is [docs/RELEASING.md](docs/RELEASING.md#contributor-flow).

---

## 18. Release workflow

File:

```text
.github/workflows/release.yml
```

The run is manual, as recommended, and takes four inputs: `dry_run` (preview), `first_release` (resolve versions from `package.json` because no release tags exist yet), `publish_only` (publish the versions of an already-tagged release commit) and `create_github_releases` (one GitHub Release for the wave, default `true`).

The shipped flow, in the order the workflow runs it:

```text
Manual release trigger (workflow_dispatch on a ref)
        ↓
checkout that ref with the full history
        ↓
pnpm install --frozen-lockfile
        ↓
apply the committed Nx Version Plans, calculate independent versions, write project changelogs, commit it all (nx release --skip-publish)
        ↓
select the released packages; preflight npm (every version either exists there or is publishable, every range the wave publishes resolves)
        ↓
release gates: one runner per released package verifies, packs its tarball and installs that tarball in a clean environment; a second job runs the repository-wide gates and an Nx sweep of everything the release does not publish
        ↓
publish to npm through OIDC, in dependency order
        ↓
verify every published version installs from the registry
        ↓
tag the wave: one annotated release/<date> tag
        ↓
push the release commit and the tag
        ↓
create one GitHub Release for the wave and attach every .tgz
```

Two corrections against the flow this section originally sketched: dependency ranges are not rewritten at release time (§14), and the release commit precedes publication rather than following it — nothing is pushed until npm holds every version, which is what makes a pushed tag a claim a consumer can act on.

A later iteration may automate release execution after merge once the pipeline has proven reliable.

The dry-run-then-live maintainer sequence, the `publish_only` recovery and the failure recipes are [docs/RELEASING.md](docs/RELEASING.md#maintainer-flow) and [docs/RELEASING.md](docs/RELEASING.md#failure-recovery).

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

The repository ships no `NPM_TOKEN` at all: the workflow publishes through OIDC, and `scripts/publish-release.mjs` runs `npm publish <tarball> --access public` per package, in dependency order. Registering each package's Trusted Publisher, and the one manual first publish a brand-new name needs before Trusted Publishing can answer it, is [docs/RELEASING.md](docs/RELEASING.md#a-new-package-needs-one-manual-first-publish).

---

## 20. Git tags and GitHub Releases

Package versions stay independent (§12), but a release run is one event, so it is marked once: the wave it publishes gets one annotated tag and one GitHub Release.

```text
release/2026-09-24
release/2026-09-22-2
```

`release/<UTC date>`, with a `-<n>` suffix when that day already carries a wave. The tag is created after npm holds every version of the wave and is pushed with the release commit, so a tag in this repository always names a commit the registry already serves — and the tag list stops growing by one tag per released package.

The GitHub Release has the same shape: one per wave, titled `Release <date>`, with every package's `.tgz` attached and each package's changelog entry in the notes. It is created by `gh release create` in the workflow, not by Nx (§14).

Package identity is still recoverable from a wave tag: the release commit it points at records the version every package in the wave was bumped to, and each project's `CHANGELOG.md` carries the entry its version plan wrote.

The per-package scheme this section originally recommended —

```text
@yadsh/dsh-draft-sessions@1.4.2
@yadsh/dsh-ui-tweaks@0.7.1
```

— is historical, and there is nothing of it left to read. `git ls-remote --tags` against either remote, and `git tag -l` in a fresh clone, list the `release/*` waves and no `name@version` tag; the census was taken on 2026-09-28, and `scripts/repo-config.test.mjs` re-runs it on every `pnpm test:release` by asking the remotes the checkout points at rather than reading that checkout's own ref store — a clone that outlived a rewrite keeps the tags the repository dropped, next to the housekeeping refs (`backup/*`, `pre-rebase*`) its owners mint locally, and a local read would redden the gate over a tag this section never mentions. Where the read comes back short — this checkout points at no remote, one of its remotes does not answer, or none advertises a `release/*` wave — the case reports itself skipped rather than passed, because a tag set nobody measured, or measured only over the remotes that did answer, is not a tag set that came back empty. The releases the per-package scheme made are in this history as commits (`chore(release): publish` runs back to 2026-08-30, and the first wave tag is `release/2026-09-17`), but no tag of that shape is reachable on them, so the three paths that still read it are insurance rather than a live dependency:

- `scripts/check-release-plans.mjs` falls back to `{projectName}@*` when the head reaches no `release/*` tag. With neither shape reachable the gate reads the project as never shipped and counts its whole change against the base — the conservative answer, not a hole (§13).
- The `publish_only` path takes a per-package tag as the proof that a release of the older shape was already published; on this history it stops at `Missing release tag` instead of republishing one of those commits.
- The GitHub Release step keeps a per-package loop for a released ref that carries no wave tag — a ref only a tag of the older shape would identify.

Do not read those fallbacks as the target shape, and do not mint new tags of that form — the wave tag is the only tag a release run creates.

See [docs/RELEASING.md](docs/RELEASING.md#maintainer-flow) for the order that produces the tag and [docs/RELEASING.md](docs/RELEASING.md#failure-recovery) for what a missing tag or release is recovered with.

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

Root `package.json` provides the convenient commands — this excerpt is the current file:

```json
{
  "scripts": {
    "build": "nx run-many -t build",
    "test": "pnpm test:release && nx run-many -t test",
    "typecheck": "nx run-many -t typecheck",
    "lint": "pnpm lint:workspace && nx run-many -t lint",
    "check": "pnpm lint && pnpm format && pnpm typecheck && pnpm test && pnpm build && pnpm check:files && pnpm verify && pnpm deps:check",

    "affected:build": "nx affected -t build",
    "affected:test": "nx affected -t test",
    "affected:check": "nx affected -t lint typecheck test build verify",

    "release:plan": "nx release plan",
    "release:check": "node scripts/check-release-plans.mjs",
    "release:dry-run": "nx release --dry-run"
  }
}
```

`check` is the local one-shot a contributor runs before opening a PR, and `release:check` is the version-plan gate §13 describes — a repository script, not `nx release plan:check`, and the identical command CI runs. The block is an excerpt of the root `package.json`, which is where these commands are defined: the runbooks restate them, they do not own them.

[docs/VERIFICATION.md](docs/VERIFICATION.md#local-one-shot) walks the order `check` runs and [docs/VERIFICATION.md](docs/VERIFICATION.md#gate-map) says what each gate asserts.

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
11. A plugin must not depend on another plugin unless that edge is declared with
    a reason in `plugin-dependency-allowlist.json`. Every dependency field counts,
    and a missing file means no such edge is allowed.
12. A third-party range a named catalog holds is declared through that catalog
    rather than re-typed as a literal, so one edit moves every consumer. Packing
    rewrites the catalog back to its range, so the published manifest is
    unchanged. `peerDependencies` are exempt: a published peer range is a
    compatibility promise and stays wider than the exact version a catalog pins
    for local builds. A range no catalog covers is reported, not forbidden — a
    library one package uses has no shared place to live, while a range two
    packages share, or one the manifests resolve by two different ranges, is
    what a catalog exists to end.

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
dsh plugin --profile <profile> add @yadsh/dsh-plugin-name

Tarball:
dsh plugin --profile <profile> add ./package.tgz

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
- publish to npm;
- create one `release/<date>` wave tag per release run (§20);
- create one GitHub Release per release run (§20);
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
- [ ] Release pipeline generates changelogs and the wave tag.
- [ ] Release pipeline can publish affected packages to npm.
- [ ] One GitHub Release per release run carries every released package's changelog and `.tgz` (§20).
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
