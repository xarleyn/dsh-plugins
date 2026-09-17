# Scan recipes

Commands are run from the repository root. `$S` is the scanner:

```bash
S=.agents/skills/leak-scan/scripts/leak-scan.mjs
```

## 1. Working tree — what a commit publishes

```bash
node "$S" --tree                    # tracked + untracked-not-ignored files
node "$S" --tree --only plugins/dsh-qa-surface
node "$S" --tree --json > report.json
```

Independent quick greps, for when you want a second opinion that does not share
the scanner's code (replace the sample shapes with your own marker set):

```bash
git grep -inE '\b[A-Z][A-Z0-9]{2,9}-[0-9]{1,6}\b' -- . ':!*.lock'
git grep -inE '\b(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}\b' -- .
git grep -inE 'https?://[A-Za-z0-9._-]+\.(corp|lan|local|internal)\b' -- .
git grep -inE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- . | grep -v example
```

Ranges matter: `\bREAL\b` does not match `STREAM`, but a bare substring search
does. Pick word boundaries for short tokens and substrings for long ones.

## 2. History and refs — what a clone publishes

```bash
node "$S" --history                 # every blob reachable from any ref
node "$S" --history --no-refs       # faster, no ref attribution
```

The report adds `[refs/…]` to each history finding and lists every ref that
still reaches leaked content. That list is the actionable part after a rewrite:
a clean `main` says nothing about a stale local branch, a tag, `refs/codex/*`
or the stash.

Follow-ups on a hit:

```bash
git log --all --oneline -S'<literal>'            # which commits introduced it
git branch -a --contains <sha>
git tag --contains <sha>
git stash list                                   # stash holds work, not commits
git for-each-ref --format='%(refname)' | wc -l    # how many refs exist at all
```

Cleaning stale refs after a rewrite (decide with the user first — tags and
backup branches may still be wanted):

```bash
git stash list && git stash drop 'stash@{0}'     # pre-scrub work in the stash
git branch -D <stale-branch>                     # each branch the scan named
git tag -d <stale-tag>
git for-each-ref --format='%(refname)' refs/codex | xargs -r -n1 git update-ref -d
git gc --prune=now                               # only after the refs are gone
```

Until that is done, never run `git push --all` or `git push --tags` from this
working copy, and do not hand out clones of it.

## 3. Packed tarball — what the registry publishes

```bash
pnpm build                                    # the pack list follows built output
node "$S" --pack
pnpm tarball:verify --all                     # the repository's own gate
```

`--pack` asks npm for the file list of every publishable package
(`npm pack --dry-run --json`) and scans those files. It also flags packed prose
(`docs/**/*.md`), tests, `src/`, TypeScript sources and snapshot files, because
each of those has shipped by accident at least once.

To inspect a real tarball, built exactly as npm would:

```bash
npm pack --pack-destination /tmp --ignore-scripts   # in the package directory
tar -tzf /tmp/<pkg>-<version>.tgz | head -50         # file list
tar -xzf /tmp/<pkg>-<version>.tgz -C /tmp/out
git grep -inE '<marker shapes>' -- /tmp/out/package  # scan the extracted tree
```

Manifest review: `files` in `package.json` decides the surface. npm always adds
`README.md`, `LICENSE`, `package.json` and the `main` entry, so a leak in the
README is a leak in every version ever published.

## 4. Registry and GitHub — what is already out

```bash
# does a version exist, and what does its tarball contain?
curl -sI https://registry.npmjs.org/@yadsh%2F<name>/<version> | head -1
npm pack @yadsh/<name>@<version> --pack-destination /tmp --ignore-scripts

# what did the release note say (release bodies are public)?
gh release list --limit 20
gh release view <tag> --json body --jq .body

# do pull-request refs still expose pre-rewrite commits?
gh api "repos/xarleyn/dsh-plugins/git/refs" --jq '.[].ref' 2>/dev/null \
  || git ls-remote origin | sed -n '1,40p'

# forks keep old objects alive even after a force-push
gh api repos/xarleyn/dsh-plugins/forks --jq 'length'
```

Facts to keep in mind: `git ls-remote` on this repository lists `main` plus
`refs/pull/*/head`, and pull refs point at pre-rewrite commits that GitHub will
not let you delete. A `--mirror` push fails for the same reason — push explicit
refspecs instead.

## 5. Building a marker dictionary for a new incident

Collect the real values from wherever they were observed, dedupe, and write
them to `~/.dsh-leak-markers.txt`:

- **The rewrite dictionary.** `git filter-repo --replace-text` takes a file of
  `marker=replacement` lines; the removed side is a ready-made list. Same for a
  `--sensitive-data-removal` report.
- **Removed file contents.** `git show <old-sha>:<path>` from any ref the
  scanner still blames, or the backup bundle made before the rewrite.
- **Published tarballs.** `npm pack <pkg>@<bad-version>` and scan the extracted
  tree — that is the copy that cannot be retracted.
- **Pull-request diffs.** `gh pr diff <n>` shows what a branch still adds.
- **Past sessions.** A value may have been pasted into a conversation before it
  ever reached a file: the `zcode-session-forensics` skill searches the local
  session store. This is also how the *conventions* of an incident are
  recovered — what was committed, what was asked for, what was decided.

Then:

```bash
node "$S" --tree --hosts all        # markers now load automatically
```

Mark the entries that will match by chance (short acronyms, bare numbers) with
`noisy:` so they report as review. Add both cases of a short token.

## 6. Independent verification (post-scrub)

A clean scan with the same dictionary that produced the rewrite proves only
that the dictionary ran. Re-check with patterns the dictionary does not contain:

```bash
CMD='git rev-list --objects --all | cut -d" " -f1 | sort -u'
# per-ref tree check
for ref in $(git for-each-ref --format='%(refname)'); do
  git grep -lE '<independent patterns>' "$ref" -- . 2>/dev/null | sed "s|^|$ref |"
done
# history check that ignores the dictionary
git log --all --oneline -G'<shape that must not exist>' | head
git log --all --oneline -S'<literal>' | head
```

Also check the two artifacts a text replacement can silently break:

```bash
git diff <rewrite-start>..<rewrite-end> -- pnpm-lock.yaml    # must be empty
git rev-list --count <ref>                                   # commit count as expected
```

If a dictionary entry was a bare three-letter token, the lockfile check is not
optional: without word boundaries the replacement walks through base64 integrity
hashes and rewrites the lockfile.
