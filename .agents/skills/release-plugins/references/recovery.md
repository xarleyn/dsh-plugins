# Recovery

Nothing before the push has left the runner, so almost everything is "fix the
cause and rerun". `docs/RELEASING.md` is canonical; this is the same material as
a decision table, plus the commands.

## Decide by where it stopped

| Where it failed | State of the world | What to do |
| --- | --- | --- |
| Plan gate, versioning, registry pre-flight, dependency check, a package job, the tarball checks | Nothing published, nothing pushed, **plans intact** | Fix the cause, rerun. Because validation is fanned out per package, re-running only the failed jobs retries those packages instead of the whole workspace. |
| `Publish to npm with OIDC` | Some packages may be on npm; **nothing pushed**; plans intact | Read the report: it lists every rejected package *and* every package held back because a dependency did not publish. Missing name → bootstrap it by hand. Existing name with `404` → the workflow is not a publisher; register the Trusted Publisher. Then rerun — it resolves the same versions, adopts what npm has, publishes the rest. |
| `Verify the published versions install` | The wave is on npm; **nothing pushed** | The message names the range npm cannot satisfy. The versions stay published: fix the manifest and release again — the rerun adopts them and publishes the fix as the next version. |
| `Push release commit and tags` | npm has every version; the branch did not move | **Rerun without changing the branch.** The skip assumes the tarball matches what was published, so changing the branch first would leave a fixed source unpublished under a version npm already has. |
| `Create the release-wave GitHub Release` | Everything else succeeded | Rerun with `publish_only=true` and `create_github_releases=true`: already-published versions are skipped and the Release is created from the wave tag on the pushed commit. A single missing tarball can be attached with `gh release upload <wave-tag> <file.tgz>`. |

## Commands

```bash
# rerun the wave as-is
gh workflow run release.yml --ref main -f dry_run=false -f first_release=false \
  -f publish_only=false -f create_github_releases=true
gh run watch <run-id> --exit-status

# rebuild the missing GitHub Release from the ref that carries the release
# commit — its wave tag works, and is the safest thing to name
gh workflow run release.yml --ref release/<date> -f dry_run=false \
  -f first_release=false -f publish_only=true -f create_github_releases=true

# attach one tarball by hand
gh release upload release/<date> <file>.tgz --clobber
```

## Recovering versions that are tagged but missing from npm

This is the state the pipeline was reworked to make impossible: per-package tags
and changelog entries exist, the plans have been consumed, and npm does not have
the versions. It happens only if publication ran before the push, i.e. under the
old flow.

`publish_only=true` is the tool — it reads tags rather than plans, so no plans
are needed:

```bash
# always preview first
gh workflow run release.yml --ref <ref> -f dry_run=true  -f first_release=false \
  -f publish_only=true -f create_github_releases=true
gh workflow run release.yml --ref <ref> -f dry_run=false -f first_release=false \
  -f publish_only=true -f create_github_releases=true
```

Preconditions, and they are the whole difficulty:

- The ref must still carry the release commit those tags point at. Check it
  (`git log --oneline -1 <tag>` against the branch) before dispatching.
- Do **not** dispatch it on the default branch if the default branch's
  `package.json` versions are older than the tags — the tag verification fails
  and the run is wasted.
- Recover the lagging versions *before* versioning the next wave. Once a later
  release moves a package forward, the earlier missing version is unreachable:
  `publish_only` selects by the versions in the tree it packs.

## Verifying the result

```bash
# the whole wave, as a consumer would
node scripts/workspace-packages.mjs --format=tsv > "$TMPDIR/rows.tsv"
node scripts/publish-release.mjs --verify-install --tsv="$TMPDIR/rows.tsv"

# one version (per-version document — the package document is CDN-stale)
curl -sS "https://registry.npmjs.org/@yadsh%2F<name>/<version>" | head -c 400

# provenance: present for CI publications, absent for hand-made ones
npm view @yadsh/<name>@<version> --json | grep -A2 attestations
```

A missing version right after a successful publish is usually the cache, not the
publish. The publish step's own log lines (`+ @yadsh/<name>@<version>`) are the
evidence; re-query the registry after a pause before concluding anything.

## After a successful wave

- Confirm the wave tag is on the release commit and the GitHub Release carries
  every tarball. The release commit (`chore(release): publish`,
  `github-actions[bot]`) contains the versions, the changelogs and the deletion
  of the consumed plans.
- `pnpm release:check` should report nothing unreleased.
- Treat any version published by hand as adopted: the wave took it, but it has no
  provenance, so it is not evidence that the pipeline works.
