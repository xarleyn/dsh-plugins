# Release Runbook

This repository uses independent Nx Version Plans. A release is derived from
committed `.nx/version-plans/*.md` files; maintainers do not choose bump types
again in the release workflow.

## One-time setup

1. Confirm that the `@yadsh` npm organization exists and that maintainers have
   permission to publish every public package in this repository.
2. Make `main` the repository default branch and protect it with the **CI /
   Verify affected projects** check.
3. In npm package settings, configure this GitHub repository and
   `.github/workflows/release.yml` as the Trusted Publisher for every public
   package.
4. Ensure GitHub Actions can create releases and push the release commit and
   tags. The workflow requests only `contents: write` and `id-token: write`.

Never add an npm automation token to this workflow. Trusted Publishing uses
GitHub OIDC, and npm generates provenance automatically for supported public
packages and repositories.

### A new package needs one manual first publish

Trusted Publishing cannot create a package name. A Trusted Publisher is
registered on a package that already exists, so the registry rejects a
workflow's very first publish of an unknown name with a misleading `404`. The
release workflow stops on that before it versions anything, and prints the
recovery. Publish the first version once, from a maintainer's machine:

```bash
npm login                                             # or a granular access token
npm publish ./yadsh-dsh-<name>-<version>.tgz --access public
```

The `.tgz` is the `npm-tarballs` artifact of that run, or `pnpm --dir
plugins/dsh-<name> pack`. Then add this repository and workflow as the
package's Trusted Publisher, and rerun the release workflow: it publishes
nothing for the version you just uploaded and handles every later version
through OIDC.

## Contributor flow

1. Make the package change.
2. Run `pnpm release:plan` and select the affected public packages.
3. Commit the generated Markdown plan with the implementation.
4. Run `pnpm check`, `pnpm deps:check`, and `pnpm tarball:verify`.
5. Open a PR — or push, since the gate runs on both. CI checks that every
   publishable package whose commits no release tag covers yet is named by a
   plan. A pull request into a `dsh-v*` release branch runs the same checks as
   one into `main`, and a commit pushed straight to `main` is checked by the
   same gate: a plan that only a PR would have required is one the release
   needs just as much when the commit arrives without one.

A plan file must open with its `---` front-matter fence. Nx silently ignores a
plan it cannot parse, so the release gate and `pnpm verify:packages` reject such
a file instead of letting the run release nothing.

`pnpm release:check` is the same command locally and in CI
(`scripts/check-release-plans.mjs`). The check reads each publishable release
project against the newest release tag its history can reach — the
`release/<date>` tag the workflow creates once per release run — and asks for a
plan only when commits no tag covers have landed since. Comparing every project
against the default branch instead would report an already-published release as
unreleased and demand plans the release has consumed. A project that never
shipped has no tag, so its whole change against the base counts. Uncommitted
work is reported as pending rather than judged, because the release reads
commits too. The check ignores the files Nx ignores for this decision, so a
release commit that only rewrites versions and changelogs needs no further plan.

## Maintainer flow

1. Merge the PR into `main`.
2. Run the **Release** workflow with `dry_run=true`.
3. Review resolved versions, dependent bumps, and generated changelogs.
4. Run the workflow again with `dry_run=false`.
5. For the repository's first release only, also set `first_release=true`.

`create_github_releases` defaults to `true`. Set it to `false` for a routine
package update or hotfix that should still receive a release commit, changelog,
wave tag, workflow artifact, and npm publication, but should not create the
GitHub Release.

The live workflow asks Nx to create the release commit and project changelogs
without publishing or tagging. Nx commits the versions and changelogs but
removes the consumed version plans outside that commit, so the workflow stages
the workspace and folds the removal into the release commit before that commit
leaves the prepare job. It then selects the released packages, checks that every
one of them already exists on npm — reporting any version npm has ahead of the
repository, which the wave adopts rather than republishes — and that every
dependency range the wave would publish resolves to a version this wave
publishes or npm already has, and fans the validation out: one runner per
released package verifies it, packs its tarball and installs that tarball into a
clean npm environment, while a second job runs the repository-wide gates and an
Nx sweep over every project the release does not publish. Between them the two
jobs verify the whole workspace exactly once. Only once every job has passed
does one runner publish the versioned projects through npm OIDC in dependency
order — a package whose dependency did not publish is held back instead of
published broken — and only once npm has every version, and each of them
installs from the registry, does it tag the release wave with one
`release/<date>` tag, push the release commit and the tag, and create one
GitHub Release for the whole wave, with every `.tgz` attached and each package's
changelog entry in the notes.

The release commit exists only on the prepare runner, so the jobs below it work
on a fresh checkout of the released ref plus a patch of that commit — every
commit Nx created since the ref, replayed with `git am`, message and authorship
included. Packing, tarball verification and publication therefore all read the
same commit the push records.

The order is the point: the branch never advances to a state the registry does
not already reflect. A release that fails at any step before the push leaves
the branch exactly as it was, version plans included, so it is fixed by
rerunning the workflow rather than by hand-publishing versions and repairing
tags afterwards. A publish that stops partway is finished by the same rerun:
versions npm already has are adopted, and nothing is published that installs
from a package npm is missing.

## Test releases from a branch

The workflow releases whatever ref it was dispatched on, so a branch can
produce test versions without touching `main`. That release consumes the
branch's version plans, exactly like a release on `main` — plans and the wave
tag move only once npm has every version:

- The released projects stop needing a plan, because the check reads each
  project against the wave tag the release created: it covers the commits the
  plans were written for.
- Keep adding a plan for anything you change after that release. What the wave
  tag covers is the work it released, not the work that follows it.
- A later release from the same branch needs a fresh plan, since the workflow
  requires at least one parseable plan before it will version anything.

## Failure recovery

Everything before publication is rerunnable, because nothing has left the
runner yet:

- If versioning, the registry check, the validation gates, or the tarball
  checks fail, fix the cause and rerun the workflow. The version plans are
  still in the branch; the failed run's local release commit is discarded with
  its runner. Because validation is fanned out per package, re-running the
  failed jobs retries only the packages that failed instead of the whole
  workspace.
- If the **Publish to npm with OIDC** step fails, it reports every package npm
  rejected plus every package it held back because one of their dependencies
  did not publish, and nothing was pushed. A package the registry does not know
  yet means it has no first publish: follow *A new package needs one manual
  first publish* above. A `404` for a package that exists means the workflow is
  not one of its publishers: register this repository and workflow as that
  package's Trusted Publisher, or publish that tarball once by hand with a
  token that covers the name. Then rerun the workflow — it resolves the same
  versions, adopts what npm already has, and publishes the rest.
- If **Verify the published versions install** fails, the wave reached npm but
  a consumer cannot resolve it: the message names the range npm could not
  satisfy. Those versions stay published, so fix the manifest and release
  again — the rerun adopts the versions npm has and publishes the fix as the
  next version.

Publication succeeded but the branch did not move, which is the one state that
needs an explicit decision:

- If the **Push release commit and tags** step failed, rerun the workflow
  without changing the branch. The versions are already on npm and skipped; the
  release commit and the wave tag are recreated and pushed. Changing the
  branch first would let a package whose version npm already has keep a fixed
  source unpublished, because the skip assumes the tarball matches what was
  published.
- If **Create the release-wave GitHub Release** failed, rerun with
  `publish_only=true` and `create_github_releases=true`: already published npm
  versions are skipped, and the missing release is created from the wave tag
  on the pushed release commit with freshly verified tarballs. A single
  missing tarball can also be attached with `gh release upload` on the wave
  tag.
- `publish_only=true` publishes the versions of an already-pushed release
  commit and nothing else: it packs the branch it runs on, so run it while the
  branch still carries that release commit — its wave tag, or, for a release
  made before the wave scheme, every package's per-project tag — not after
  further work has been merged. `git diff` the tag against the branch first
  when in doubt.

Publication is not ready until npm Trusted Publishers have been configured
externally for the `@yadsh` packages.
