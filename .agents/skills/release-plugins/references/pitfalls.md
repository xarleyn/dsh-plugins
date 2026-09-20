# Incident catalogue

Every entry here cost this repository a release or a red CI run. Symptom first,
because the symptom is what you will see; the cause is what the symptom never
tells you.

## A. Version plans and the plan gate

### A plan without its front-matter fence is ignored in silence
**Symptom.** A feature is committed, the release runs, and its changelog entry
simply is not there. No warning, no error, no bump.
**Cause.** Nx parses a plan by its opening `---`. A file that lost the fence has
empty front matter, so Nx neither applies it, nor deletes it, nor counts it in
`plan:check`. The plan looks present to a human and does not exist to Nx.
**Fix / catch.** `node scripts/verify-package-hygiene.mjs --version-plans-only`
rejects it, and `pnpm verify:packages` validates every plan the way Nx reads
them; the release workflow runs the former as its first step.

### `Inexact release:check` red is usually not your debt
**Symptom.** `pnpm release:check` names a dozen projects "touched" with no plan.
**Cause.** Two known false positives. (1) Comparing every project against the
base branch reports already-released work as unreleased — which is why the check
now resolves each project against the newest **release tag** its history can
reach, not against `base..head`. (2) A modified `pnpm-lock.yaml` maps onto every
project through the Nx lockfile plugin, and no `ignorePatternsForPlanCheck`
entry removes that.
**Fix / catch.** Read the missing list against *your own* projects: if a project
in the list has zero commits since its own last release tag, the plans for it
were already consumed and adding more causes a double bump. Do not "fix" it by
writing plans.

### Uncommitted work is invisible to the plan gate
**Symptom.** Green `release:check` before the commit; the PR goes red after it.
**Cause.** The gate reads commits, like the release does. It prints
`N path(s) … uncommitted, and are checked once committed` as its own line.
**Fix / catch.** Re-run it on the committed tree. A green pre-commit run proves
nothing about whether a plan will be seen.

### A plan is per package, not per change
**Symptom.** Two features of one package produce one changelog paragraph, or a
fix disappears under somebody else's plan.
**Cause.** Several plans for one package merge into one bump (the highest) and
one entry. A pending plan for the package already covers your fix.
**Fix / catch.** Before writing a plan, look for one already pending for that
package. Conversely, a committed `feat` with no plan of its own never appears in
any changelog — reconcile with `git log <tag>..HEAD --plugins/<name>` before
releasing, not after.

### A release from a branch consumes that branch's plans
**Symptom.** The branch's PR was green on plans before the release and is green
after; a later release from the same branch refuses to version anything.
**Cause.** The wave tag the release created covers the commits the plans were
written for, so those projects stop needing a plan — but the workflow still
requires at least one parseable plan before it will version anything.
**Fix / catch.** Keep adding a plan for anything changed *after* the release.
The wave tag covers what it released, not what follows it.

## B. The release commit and the replay

### `git am` refuses the release patch: `does not match index`
**Symptom.** Every job below `prepare` fails on the replay step:

```
error: <path>/scripts/<file>.mjs: does not match index
Applying: chore(release): publish
Patch failed at 0001 chore(release): publish
```

`Publish the release` then goes skipped — nothing reached npm, the branch did
not move, nothing needs rolling back.
**Cause.** A file change that is not content: `pnpm install` makes a package's
`bin` targets executable (`0755`) on POSIX, while git has the file as `100644`.
`Capture the release commit` stages everything, so the `mode change` lands in the
patch, and `git am` refuses a worktree whose stat data disagrees with the index —
even when the bytes are identical.
**Fix / catch.** Store the entry point executable
(`git update-index --chmod=+x <file>`) so the chmod is a no-op, and replay the
patch **before** installing dependencies (the current step order in both the
`gates` and `projects` jobs). `core.fileMode false` does not help: the chmod
moves `ctime`, which the stat comparison also reads.
**Windows never reproduces this** — `EXECUTABLE_SHEBANG_SUPPORTED` is false
there, and an `-rwxr-xr-x` listing on NTFS is an msys shebang heuristic, not
evidence. When you add a `bin` that points at a tracked file, commit the exec bit
in the same change.

### Consumed plans outside the release commit
**Symptom.** After a release, the branch still carries the plan files, and the
next run applies them a second time.
**Cause.** Nx commits the versions and changelogs but removes the consumed plans
outside that commit.
**Fix / catch.** The prepare job stages the workspace and folds the deletion into
the release commit (`git add --all` + amend of the commit Nx just made). Keep
that amendment bounded to the commit the run produced — the base commit is
already pushed and is never rewritten.

### Artifacts are immutable inside a run
**Symptom.** Re-running a failed job fails with `409 Conflict run_attempt` on
upload.
**Cause.** `actions/upload-artifact@v4` cannot overwrite its own artifact.
**Fix / catch.** `overwrite: true` on every upload in the workflow. If you add a
new upload, add it too.

## C. Publication

### The first publish of a new package cannot come from the workflow
**Symptom.** `npm error 404 Not Found - PUT https://registry.npmjs.org/@yadsh%2F<name>`
for a package that exists nowhere yet.
**Cause.** A Trusted Publisher is configured on a package that already exists, so
OIDC carries no authority to *create* a name. npm answers that with a misleading
`404`, not a `403`.
**Fix / catch.** Publish the first version once from a maintainer's machine
(`npm publish ./yadsh-<name>-<version>.tgz --access public`), register this
repository and `.github/workflows/release.yml` as the package's Trusted
Publisher, then rerun — the version you uploaded is adopted. The workflow checks
existence *before* the fan-out, so the failure costs seconds.

### `404` on a package that already exists
**Symptom.** Same 404, but the package has versions on npm.
**Cause.** The workflow is not one of that package's publishers. This is what a
missing Trusted Publisher registration looks like from inside the publish loop.
**Fix / catch.** Register the publisher, or publish that tarball once with a
token that covers the name — never add an npm token to the workflow. The health
signal for a version is provenance: `dist.attestations` in
`npm view <name>@<version> --json` is present for CI publications and absent for
hand-made ones.

### Publishing in the wrong order ships an unresolvable registry
**Symptom.** Ten of thirteen packages publish, three fail, and the versions that
did publish require a dependency version that is not on npm — nothing the wave
produced installs.
**Cause.** The loop walked the workspace selection directly, where packages come
after plugins, so a shared package that thirteen plugins depend on was published
*last*. An aborted loop also stopped at the first failure, silently dropping
everything after it.
**Fix / catch.** `scripts/publish-release.mjs` owns publication: it sorts the
wave topologically, adopts versions npm already has, collects every failure
instead of aborting, and refuses to publish a package whose dependency did not
publish. Never replace it with a shell loop. Rehearse locally with `--check`
(dependency ranges resolve) and confirm after with `--verify-install` (each
version installs).

### The branch advanced past the registry
**Symptom.** A tag and a changelog entry exist for a version npm does not have,
and the plans are gone.
**Cause.** The push used to run *before* publication. A mid-loop failure left the
repository ahead of the registry with no plans to re-derive the release from.
**Fix / catch.** The order is `preflight < resolves < publish < installs < wave
tag < push`, and `scripts/release-workflow.test.mjs` pins it. A rerun resolves
the same versions, adopts what npm already has and publishes only the rest — but
only because nothing was pushed.

### Publishing by hand corrupts the wave's accounting
**Symptom.** A version the wave planned is reported as "published outside the
release flow", and the install gate treats it as foreign.
**Cause.** The wave adopts npm versions it did not publish, so a manual publish
is tolerated — but it has no provenance, and the skip assumes the tarball matches
what you uploaded.
**Fix / catch.** Hand-publish only to bootstrap a brand-new package name (C1) or
to unblock a missing Trusted Publisher (C2), and then rerun the workflow rather
than continuing by hand.

## D. Tags and release state

### Per-package tags are load-bearing
**Symptom.** You delete a package's old `@version` tag to tidy up, and its
GitHub Release becomes a draft.
**Cause.** Three things anchor on tags: the plan gate uses the newest reachable
release tag, `publish_only` verifies per-package tags for pre-wave releases, and
the GitHub Release was created with `--verify-tag`.
**Fix / catch.** One annotated wave tag `release/<date>` per run is the current
scheme and replaces per-tag releases. Prune old tags only *after* a wave tag
exists to anchor the plan gate — remove them earlier and a push to the default
branch goes red on version plans with no anchor left.

### `publish_only` packs the branch it runs on
**Symptom.** A `publish_only` run publishes the wrong content, or refuses.
**Cause.** It reads no plans: it takes the versions from the tree it checked out
and packs that. Its guard only checks that the ref carries the release tag.
**Fix / catch.** Run it while the branch still carries the release commit —
right after a failed push, or on a wave tag — and `git diff` the tag against the
branch first if any doubt. Merging further work in first makes it publish the
wrong tree under an existing version.

## E. Local and CI environment

### A push to a release branch runs nothing
**Symptom.** You push to a branch and no CI appears.
**Cause.** `ci.yml` fires on `push` to `main` and on `pull_request` into `main`
or `dsh-v*`. A push to a branch has no CI of its own.
**Fix / catch.** The run you are watching is the PR's. If the branch has no open
PR, it has no CI.

### Environment supplied by the CI job leaks into tests
**Symptom.** Repository-tooling tests pass locally and fail only in CI with an
unresolvable SHA.
**Cause.** `nrwl/nx-set-shas` exports `NX_BASE` / `NX_HEAD` for the *outer*
repository, and a test that passes the whole `process.env` into commands run
against a temporary fixture hands those SHAs to the fixture's git.
**Fix / catch.** Runners delete the variables they own before shelling into a
fixture. When a test is green locally and red only in CI, suspect the job's
environment before suspecting your change.

### Platform-specific path semantics
**Symptom.** A config test fails only on Linux.
**Cause.** `path.isAbsolute("D:/x")` is `false` on POSIX, so a Windows path read
as absolute passes locally and fails there.
**Fix / catch.** Normalize with a platform-independent rule when the value is
user-supplied config, and keep the test that pins it.

## F. Changelogs and published prose

### A published section is frozen
**Symptom.** The shipped section of a changelog describes features the published
tarball does not contain.
**Cause.** Entries were appended to a section that had already been released —
sometimes before the feature was even committed.
**Fix / catch.** Write the new text for the *planned* version, in the same change
as the plan. For `dsh-qa-surface`, `QaChangelog.tsx` carries the curated history
and the tests pin it: the entry above `QA_VERSION` must be the next planned
version, and entries below the current version must not be added. To check what a
released version actually contains, pack it and grep the tarball
(`npm pack <name>@<version>`) — the source tree will tell you the wrong story.

### A changelog section can silently lose commits
After a wave, spot-check the generated `CHANGELOG.md` against
`git log <previous wave tag>..<wave tag> --plugins/<name>`: a section can be
missing commits that really did ship inside the tag. It is generated by Nx, so it
is not hand-editable — but it is worth knowing before someone quotes it.

## G. What a release does to consumers

- A version published minutes ago may already be invisible to `pnpm add`: newer
  pnpm has a minimum-release-age gate that prefers an older version, and the
  older version may be one whose manifest carried a raw `workspace:`/`catalog:`
  specifier. If a consumer must have the fresh version, pin it exactly.
- Installing a just-published version can fail while CDN caches catch up. The
  publish log is the evidence, not an immediate `npm view`.
- `pnpm.overrides` belongs in the root `package.json`: the pnpm version pinned by
  this repository ignores an `overrides:` block in `pnpm-workspace.yaml`
  silently.
