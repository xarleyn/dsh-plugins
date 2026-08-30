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

## Maintainer flow

1. Merge the PR into `main`.
2. Run the **Release** workflow with `dry_run=true`.
3. Review resolved versions, dependent bumps, and generated changelogs.
4. Run the workflow again with `dry_run=false`.
5. For the repository's first release only, also set `first_release=true`.

The live workflow asks Nx to create the release commit, project changelogs,
and per-package tags without publishing. It then runs all validation and
tarball installation gates, pushes the commit and tags, publishes only the
versioned projects through npm OIDC, and creates one GitHub Release per package
with its `.tgz` attached.

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

Publication is not ready until npm Trusted Publishers have been configured
externally for the `@yadsh` packages.
