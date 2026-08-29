# Releasing dsh-session-scope

Releases are built from an existing annotated SemVer tag by the
[`Release`](.github/workflows/release.yml) GitHub Actions workflow. The same
verified tarball is used for the GitHub Release, its SHA-256 checksum, the
packed-install smoke test, and npm publication.

## First publication

The package name must first be claimed by an authenticated npm account before
Trusted Publishing can be configured.

1. Confirm that `main` is green and that `package.json`, `package-lock.json`,
   and the annotated tag all contain the same version.
2. Run the `Release` workflow with `tag` set to `v0.5.0` and `publish_npm` set
   to `false`.
3. Download the `.tgz` and `.sha256` assets from the resulting GitHub Release
   and verify the checksum.
4. Sign in with `npm login`, then publish the downloaded tarball with 2FA:

   ```sh
   npm publish ./dsh-session-scope-0.5.0.tgz --access public --tag latest
   ```

5. In the package settings on npmjs.com, configure a GitHub Actions Trusted
   Publisher with these exact values:

   - organization or user: `xarleyn`
   - repository: `dsh-session-scope`
   - workflow filename: `release.yml`
   - environment: `npm`
   - allowed action: `npm publish`

The equivalent authenticated npm CLI command is:

```sh
npm trust github dsh-session-scope \
  --file release.yml \
  --repo xarleyn/dsh-session-scope \
  --env npm \
  --allow-publish
```

## Later releases

Prepare and push a version with the repository helper:

```sh
npm run release:prepare -- v0.6.0 --write
npm run check
git add package.json package-lock.json lib
git commit -m "chore: prepare v0.6.0"
git tag -a v0.6.0 -m "dsh-session-scope v0.6.0"
git push origin main v0.6.0
```

Then run the `Release` workflow with the new tag and `publish_npm` set to
`true`. The npm job uses the `npm` GitHub environment, OIDC, and the configured
Trusted Publisher; it does not require a long-lived `NPM_TOKEN`. Trusted
Publishing automatically attaches npm provenance for this public repository.

For prerelease versions such as `v0.6.0-rc.1`, the workflow publishes under
the `next` dist-tag instead of `latest`.
