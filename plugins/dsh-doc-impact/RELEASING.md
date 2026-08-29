# Releasing `dsh-doc-impact`

Releases are built from an existing SemVer tag by the `Release` GitHub Actions
workflow. The workflow checks the source, packs and smoke-tests the npm
tarball, creates or updates the GitHub Release, and optionally publishes the
same tarball to npm with provenance.

## One-time npm bootstrap

The package name must exist before npm can attach a trusted publisher to it.
For the first publication only:

1. Create a GitHub environment named `npm` and add an `NPM_TOKEN` secret that
   is allowed to create the public package. Protect the environment with a
   required reviewer if desired.
2. Push the release commit and tag, then dispatch the `Release` workflow with
   `publish_npm` enabled. The workflow's OIDC permission produces npm
   provenance while the token supplies the bootstrap publish authorization.
3. On npmjs.com, configure the package's trusted publisher with:
   - GitHub owner: `xarleyn`
   - repository: `dsh-doc-impact`
   - workflow: `release.yml`
   - environment: `npm`
   - allowed action: `npm publish`
4. Delete the `NPM_TOKEN` secret. Future releases authenticate with short-lived
   OIDC credentials only. On npm, require 2FA and disallow token publishing.

## Prepare a release

1. Start from a clean `master` branch and choose the next SemVer version.
2. Update `package.json` and `package-lock.json` together:

   ```bash
   node scripts/prepare-release.mjs v0.2.1 --write
   ```

3. Run the full source and packed-install checks:

   ```bash
   npm ci
   npm run release:check
   ```

4. Commit the version, create the matching annotated tag, and push both:

   ```bash
   git tag -a v0.2.1 -m "v0.2.1"
   git push origin master v0.2.1
   ```

5. Dispatch the `Release` workflow for that exact tag. Stable versions publish
   under `latest`; prereleases publish under `next`.

The workflow rejects a tag whose version differs from either npm manifest, so
the published metadata remains identical to the tagged source.
