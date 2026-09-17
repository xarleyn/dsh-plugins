# Incident playbook — a leak already shipped

Read `SKILL.md` first for the surfaces and the scanner. This file covers the
response: what to do, in which order, and which traps cost time in September
2026. Nothing here is reversible, so confirm each destructive step with the
user before running it.

## 0. Freeze

- Stop pushing. A push after the rewrite starts creates new commits on top of
  the old history that the rewrite will not cover.
- Stop edits in the working tree. If a rewrite is running in another clone,
  hand edits in this checkout are wasted work: they get discarded by the
  `reset --hard` that follows. Do read-only verification instead.
- Take a backup bundle of every ref before touching anything:
  `git bundle create backup.bundle --all` (keep it outside the repository).

## 1. Build the dictionary

Follow `references/scan-recipes.md` §5. Discipline that pays off:

- Word-boundary short tokens: `regex:(?<![A-Za-z0-9_])TOKEN(?![A-Za-z0-9_])`.
  A bare three-letter literal rewrites base64 in `pnpm-lock.yaml`.
- Include both cases of a short token; the sweep is case-sensitive.
- **Numbers are part of an identifier.** A replacement that changes only the
  prefix of a real key, keeping its number, looks like progress and removes
  nothing.
- Include the values a *second* pass would find: hosts, real task numbers,
  product names, domain class names, internal database names, personal logins.

## 2. Rewrite in a clone, not in the working copy

```bash
git clone --no-local --bare <repo> rewrite.git
cd rewrite.git
python -m git_filter_repo --sensitive-data-removal \
  --replace-text /path/outside/repo/replacements.txt \
  --replace-message /path/outside/repo/messages.txt
git rev-list --count --all          # sanity: refs still there
git for-each-ref --format='%(refname)' | wc -l
```

Keep `replacements.txt` outside the repository: it is a list of the very values
you are removing.

## 3. Verify before pushing

Run the independent checks from `references/scan-recipes.md` §6 — patterns the
dictionary does not contain. Then, in the clone:

```bash
node .agents/skills/leak-scan/scripts/leak-scan.mjs --history --no-refs
```

Expected: `0 leak`. Review findings will list public hosts the rewrite brought
along; those are allowlist gaps, not leaks.

## 4. Publish the rewritten history

```bash
git push --force-with-lease origin 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

- Explicit refspecs, never `--mirror`: `refs/pull/*` is read-only on GitHub and
  a mirror push fails after transferring everything.
- Tags are a separate decision. Verify what the remote has afterwards
  (`git ls-remote --tags origin`); a force-push of branches does not move tags,
  and stale tags in a local clone still walk into the old objects.
- CI follows the new SHAs only when it is triggered again; old runs and their
  artifacts stay downloadable until they are deleted or expire.

## 5. What GitHub keeps

- **`refs/pull/*/head`** still points at pre-rewrite commits. Anyone who knows
  a pull-request number can fetch the old content. Deleting the branch does not
  help; only GitHub Support can remove those refs.
- **Old commits by SHA.** A direct link to a pre-rewrite commit keeps working
  for anyone who has the SHA (changelogs, tickets, chat history). Same Support
  route.
- **Release bodies and CI artifacts** are separate objects: audit them
  (`gh release list`, `gh run list`), because a release note that mentions the
  removed value re-publishes it.
- **Forks** preserve the old objects independently — check the fork count.

## 6. What npm keeps

The registry is the part that cannot be quietly fixed.

- **Unpublish** is possible within 72 hours of publishing; after that only
  deprecation and npm Support remain. Removing the *last* version removes the
  whole package and needs `--force`.
- **Dependents block it:** unpublishing a version that other published packages
  depend on fails with `E405 has dependent packages in the registry`. Order
  matters: remove or republish the dependents first, then retry. The registry
  index lags behind, so a retry hours later may succeed where an immediate one
  fails.
- **Plan B is a neutral deprecation:** `npm deprecate <pkg>@<version> "superseded, do not use"`.
  Never describe *what* was removed — the message is public.
- **Plan C is the npm Support form** for sensitive-data removal.
- **Trusted Publisher (OIDC) settings disappear** when a package is deleted
  entirely; re-add them before the next release or publishing stops working.
- **Version numbers burn.** The next release of a removed version must be
  higher than the removed one, so plan a patch bump for every affected package
  (and note that a package with no version plan will not be republished at all).

## 7. The local repository afterwards

The remote being clean does not make the working copy clean. After a rewrite
the local checkout still contains the pre-rewrite objects, reachable from refs
nobody thinks about:

- stale local branches and backup branches,
- local tags (a force-push of branches does not update them),
- `refs/codex/*` checkpoint refs,
- `refs/stash`.

Find them, with names, before deleting anything:

```bash
node .agents/skills/leak-scan/scripts/leak-scan.mjs --history
```

Then, with the user's approval: drop the stash (`git stash drop`), delete the
branches and tags the report names, reset the local branch onto the rewritten
remote, and only then `git gc --prune=now`. Backup branches hold the old
objects by design — they are the last thing to remove, and the first thing to
keep until the rewrite is confirmed good.

## 8. Close the loop

- Add every value from step 1 to `~/.dsh-leak-markers.txt`; that is what makes
  the next sweep catch a variant.
- Re-run `--all` and check the shipped artifacts: the new npm tarball, the
  GitHub release body, the CI artifacts.
- Write the changelog entry and the release note without naming the removed
  content. A note that explains *what* leaked discloses it a second time.
- If the leak came from a fixture or a doc, fix the pattern that produced it
  (a generator, a copy-pasted spec) rather than only the instance.
