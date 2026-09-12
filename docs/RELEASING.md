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

## Contributor flow

1. Make the package change.
2. Run `pnpm release:plan` and select the affected public packages.
3. Commit the generated Markdown plan with the implementation.
4. Run `pnpm check`, `pnpm deps:check`, and `pnpm tarball:verify`.
5. Open a PR. CI checks that touched publishable packages have a plan.

A plan file must open with its `---` front-matter fence. Nx silently ignores a
plan it cannot parse, so the release gate and `pnpm verify:packages` reject such
a file instead of letting the run release nothing.

## Maintainer flow

1. Merge the PR into `main`.
2. Run the **Release** workflow with `dry_run=true`.
3. Review resolved versions, dependent bumps, and generated changelogs.
4. Run the workflow again with `dry_run=false`.
5. For the repository's first release only, also set `first_release=true`.

`create_github_releases` defaults to `true`. Set it to `false` for a routine
package update or hotfix that should still receive a release commit, changelog,
tag, workflow artifact, and npm publication, but should not create a
per-package GitHub Release.

The live workflow asks Nx to create the release commit, project changelogs,
and per-package tags without publishing. It then runs all validation and
tarball installation gates, pushes the commit and tags, publishes only the
versioned projects through npm OIDC, and creates one GitHub Release per package
with its `.tgz` attached.

## Test releases from a branch

The workflow releases whatever ref it was dispatched on, so a branch can
produce test versions without touching `main`. That release applies the
branch's version plans and deletes them, exactly like a release on `main`:

- The PR's version-plan check is skipped from then on, because release tags
  exist that only the branch carries. That is the signal that the plans were
  already applied and there is nothing left for the check to read.
- Keep adding a plan for anything you change after that release. The exemption
  covers the plans the release consumed, not the new work.
- A later release from the same branch needs a fresh plan, since the workflow
  requires at least one parseable plan before it will version anything.

## Failure recovery

- Before the release commit is pushed, rerun the workflow after fixing the
  failing gate; the runner's local changes disappear automatically.
- If the commit and tags were pushed but npm publication failed, do not create
  another Version Plan. Correct the publishing problem, then run the **Release**
  workflow with `publish_only=true`. Use `dry_run=true` first to verify the
  tagged packages and tarballs, then rerun with `dry_run=false`. Recovery mode
  skips versioning, publishes only versions with matching package tags, and is
  safe to rerun after a partial publication.
- If only GitHub Release creation failed, use `gh release create` for the
  existing package tag and attach the corresponding workflow artifact.
- To create omitted GitHub Releases later, run the workflow with
  `publish_only=true`, `dry_run=false`, and `create_github_releases=true`.
  Already published npm versions are skipped, while missing GitHub Releases
  are created from their existing tags and freshly verified tarballs.

Publication is not ready until npm Trusted Publishers have been configured
externally for the `@yadsh` packages.
