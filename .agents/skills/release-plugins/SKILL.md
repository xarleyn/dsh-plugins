---
name: release-plugins
description: Ship a release wave of this monorepo — version-plan pre-flight, the
  exact local gate set, dispatching the Release workflow (dry-run then live), and
  the failure recovery recipes. Carries the incident catalogue (first-publish
  404, publish order, git am replay, consumed plans, registry cache lies). Use
  when the user says "готовимся к релизу", "собери релиз", "запусти релиз",
  "release", "publish the wave", "выпусти версии", or asks what to check before
  tagging/publishing @yadsh packages.
---

# Release the plugins

A release is derived from committed `.nx/version-plans/*.md` files, runs only
through `.github/workflows/release.yml`, and publishes with npm Trusted
Publishing (OIDC — never an npm token). `docs/RELEASING.md` is the canonical
runbook; this skill is the operational path plus the traps that the workflow,
the gates and `RELEASING.md` do not spell out on their own.

**The one invariant to keep in your head:** the order is *publish → tag → push*.
The branch never advances to a state the registry does not already reflect, so
a failure before the push leaves the branch and the version plans exactly as
they were and is fixed by rerunning the workflow. Anything you do by hand that
puts a version on npm outside that order breaks the invariant the rerun relies
on.

## The shape of a run

`prepare` resolves the release (plans applied, release commit created, packages
selected, registry pre-flight, dependency-range check) → `gates` and one
`Package / <name>` job per released package run side by side → `publish` uploads
tarballs, publishes in dependency order, verifies each version installs, then
creates one annotated wave tag `release/<date>`, pushes commit + tag, and creates
one GitHub Release for the whole wave.

Inputs: `dry_run` (default **true**), `first_release` (false), `publish_only`
(false), `create_github_releases` (true). The workflow releases whatever ref it
was dispatched on (`github.ref_name`), so a branch can produce test versions
without touching `main`.

## 0. Pre-flight

**Is the ref pushable?** The workflow's last step pushes the ref it ran on, and
that push is the point of no return for everything in that history. Before
dispatching from `main` or a branch, confirm with the maintainer that the ref is
meant to be pushed. Machine-specific history constraints live outside the repo:
read `.private/README.md` and follow whatever local pre-flight it points at
before choosing the ref.

**Plans.** Every publishable project with commits its newest reachable release
tag does not cover needs a committed plan:

```bash
pnpm release:check                 # reads COMMITS — uncommitted work is invisible
node scripts/verify-package-hygiene.mjs --version-plans-only
```

The second command is the same one the workflow runs first: it requires at least
one plan Nx can parse. A plan that lost its opening `---` fence is *silently*
ignored by Nx — no bump, no changelog entry, not even counted — so an unparseable
plan is worse than a missing one.

**Predict the versions.** The wave bumps only the projects that have a plan;
their plans merge into the highest bump. `release.version.updateDependents` is
`never` in `nx.json`, so no dependent package is dragged in — if a predicted
version looks wrong, look for a plan you forgot, not for a dependent bump.
(`updateDependents` was `always` at one point; versions resolved by an old run
are not evidence about what this run will do.)

**`dsh-qa-surface` plans need a matching curated entry** in
`plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx` in the *same*
change — the hygiene gate enforces it, and
`plugins/dsh-qa-surface/tests/client/components/qa-sidebar-changelog.test.tsx` pins the details:
`QA_CHANGELOG[0]` must be the next planned version, `QA_VERSION` must equal
`package.json.version`, the entries from the current version down must equal the
versions parsed out of `CHANGELOG.md`, and entries *below* the current version
must not be added. A released section is frozen — write the new text for the
planned version, never into a section that already shipped.

**The manifest.** `pnpm plugins:manifest` if any `plugins/*/package.json`
changed; the hygiene gate fails on drift.

**Leak sweep.** The repository is public and the tarballs are permanent. Sweep
before a release with the local scanner (`.private/leak-scan/scripts/leak-scan.mjs
--all`; see `.private/README.md`). Plan and changelog prose is published twice —
in the repo and in the wave's release notes — so it must read neutrally: describe
what a user gets, never that something internal was removed, renamed or
misconfigured.

## 1. Local verification

Run the set the release actually depends on. `--skip-nx-cache` is not a
performance question: the Nx cache has restored green output for tasks that fail,
so a cached run is not evidence.

```bash
NX_SKIP_NX_CACHE=true pnpm check      # lint, format, typecheck, test, build, verify, deps:check
pnpm test:release                     # workflow/script contract tests — via pnpm, never `node --test`
pnpm release:check                    # plan gate, reads commits
pnpm tarball:verify                   # every package; or tarball:verify:packages plugins/<dir>
```

`pnpm check` covers `deps:check` and `verify:logging` (inside `verify`) but
**does not** cover `tarball:verify` or `release:check` — run those three
separately. Per-package equivalent, which is what the release's own matrix runs:

```bash
pnpm nx run-many -t lint typecheck test build verify --projects=@yadsh/<name> --skip-nx-cache
pnpm tarball:verify:packages plugins/dsh-<name>   # takes a PATH, not a package name
```

Before trusting a green typecheck or verify, ask whether it could be green only
because build output is sitting in the tree. A verifier that reads `lib/` is
honest only after a build, and a fresh checkout is emulated by
`rm -rf plugins/*/lib packages/*/lib` followed by
`pnpm nx run-many -t typecheck --skip-nx-cache` — in a clean checkout `lib/` does
not exist and shims the local tree never exercises are the ones that break.

Optionally rehearse the wave's dependency resolution before spending a run:

```bash
node scripts/workspace-packages.mjs --format=tsv > "$TMPDIR/rows.tsv"
node scripts/publish-release.mjs --check --tsv="$TMPDIR/rows.tsv"
```

## 1b. Stand acceptance

Green gates prove the code; they say nothing about a deployment. The failures
that reach users are composition failures — a tool that exists but is out of the
conversation's reach, an expert whose policy names tools the runtime refuses, a
reviewer whose service is missing, a model pin that no longer matches — and every
one of them passes lint, typecheck, test and verify.

So a wave that will be deployed is accepted on a stand, not in CI:

1. Stage it on the test stand (the deployment kit's dev plugin list, or its
   release list) and restart the container.
2. Run the kit's manual playbooks — `docs/manual-testing/smoke.md` after every
   deploy, `docs/manual-testing/wave.md` for a wave (a row per changed package:
   package → manual check → evidence), `docs/manual-testing/signatures.md` when
   something refuses. The kit's `scripts/qa-smoke-evidence.mjs` collects the
   evidence from the plugin logs and exits non-zero on a FAIL.
3. Record the round in a protocol file: a round without evidence and without a
   written result did not happen, and the next incident starts from zero.
4. Only then move the deployment's plugin list and repeat the smoke pass there.
   The two stands differ in pins and service set, so a difference between them is
   itself a finding.

## 2. Dispatch

```bash
gh workflow run release.yml --ref main -f dry_run=true  -f first_release=false \
  -f publish_only=false -f create_github_releases=true
# review resolved versions, dependent bumps and generated changelogs
gh workflow run release.yml --ref main -f dry_run=false -f first_release=false \
  -f publish_only=false -f create_github_releases=true
gh run watch <run-id> --exit-status
```

`--ref` is not optional in practice: the release runs on the ref you name, and
"the branch I happened to be on" is not a decision. Set `first_release=true`
only for the repository's first release. Set `create_github_releases=false` for a
routine update that should still get the commit, changelog, wave tag, artifact
and npm publication but no GitHub Release.

A dry run exercises less than it looks like: it resolves plans and versions and
`Select release packages` then reports `count=0`, so `gates`, `projects` and
`publish` are all skipped. **Replay, the tarball gates and publication are only
ever proven by a live run.**

## 3. Confirm the wave

Read the publish step's log, not the registry's mood. npm's CDN answers stale:
a version document (`https://registry.npmjs.org/@yadsh%2F<name>/<version>`) can
404 for minutes after a successful publish, and the package document (`/latest`)
lags further. Trust `+ @yadsh/<name>@<version>` lines in the publish log, then
re-query after a pause. Against a wave, prefer the whole set:

```bash
node scripts/workspace-packages.mjs --format=tsv > "$TMPDIR/rows.tsv"
node scripts/publish-release.mjs --verify-install --tsv="$TMPDIR/rows.tsv"
```

Then check that the state a user would see matches the repository: the wave tag
exists and points at the release commit, the GitHub Release carries every tarball
of the wave, and `pnpm release:check` reports nothing unreleased. The release
commit (`chore(release): publish`, authored by `github-actions[bot]`) carries the
versions, the changelogs and the **deletion** of the consumed plans — after it,
the released projects need no plan, and new work needs a new one.

A version's health is its provenance: `npm view <name>@<version> --json` should
show `dist.attestations` for anything the workflow published. A version without
it was published by hand.

The release commit is pushed by the bot, so any PR CI that runs on it sits in
`action_required` (GitHub suppresses recursive runs) until someone approves it:
`gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/approve`.

## 4. When it fails

Nothing before the push has left the runner, so the default move is to fix the
cause and rerun. The exception is "npm has it, the branch does not" — that one
needs an explicit decision. Both, with the exact commands and preconditions, are
in `references/recovery.md`.

## Traps

The catalogue with symptoms, root causes and fixes is
`references/pitfalls.md`. The ones that cost this repository a release:

- **A brand-new package cannot be published by the workflow.** Trusted
  Publishing cannot create a package name; npm answers the first publish with a
  misleading `404`. Bootstrap it once by hand, register the Trusted Publisher,
  rerun. `prepare` checks package existence before it fans the validation out
  and before anything is pushed, so the failure costs seconds.
- **`404` on a package that already exists** means the workflow is not one of
  its publishers — same fix, different cause.
- **Publish order must be dependency order.** plugins-before-packages once
  published `dsh-plugin-kit` last, leaving versions on npm that no consumer could
  install. `publish-release.mjs` owns the order now and holds back a package
  whose dependency did not publish; never reintroduce a shell loop.
- **`git am` refuses the release-commit patch** with `does not match index` when
  a `bin` target is committed non-executable: `pnpm install` chmods it `0755` on
  POSIX runners and the patch carries a `mode change`. Commit the exec bit
  (`git update-index --chmod=+x <file>`) so the chmod is a no-op. **Windows never
  reproduces this** — a local `-rwxr-xr-x` proves nothing.
- **Nx removes consumed plans outside its own commit.** The prepare job stages
  the tree and folds the deletion in, or the next run applies spent plans again.
- **`dry_run` and a cached local run both lie.** See above.
- **A flaky retry hides a real defect.** Nx marks a task flaky and passes on
  retry; a test that fails under load and passes isolated may still be broken.
  Fix it or report it, never write it off.
- **The tarball gate is the only gate that compares `exports` against the real
  build.** A copied exports map passes typecheck, tests and `pnpm check`, and
  first fails at pack time — on a push.
- **Someone else's uncommitted work is usually in the tree.** A red run may not
  be yours, and `git add -A` will take their files. Stage explicit paths and
  assert the staged count; `git add` with a nonexistent pathspec adds nothing,
  silently.
- **`pnpm test:release` via `node --test` fails** on `npm_execpath` (pnpm sets
  it). Run it through pnpm.

## References

- `references/preflight.md` — the check sequence, what each gate covers, and the
  fresh-checkout emulation.
- `references/pitfalls.md` — incident catalogue: symptom, root cause, fix, and
  how to catch it before a release.
- `references/recovery.md` — failure matrix, `publish_only` semantics, registry
  verification recipes.
- Canonical: `docs/RELEASING.md`, `docs/VERIFICATION.md`,
  `.agents/skills/create-plugin/references/release-and-gates.md`, `AGENTS.md`.
