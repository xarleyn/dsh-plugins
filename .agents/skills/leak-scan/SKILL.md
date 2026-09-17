---
name: leak-scan
description: Sweep the dsh-plugins repository, its git history, its refs and its npm tarballs for content that must not be public — internal tracker keys and their numbers, corporate hosts, private addresses, personal names, product names, tokens — and run the aftermath when something already shipped (history rewrite, GitHub refs, npm unpublish). Use before committing examples, fixtures, docs or tests; before a release; when the user asks for a leak sweep, "поиск утечек", "утечки", "секреты в репо", "почистить примеры"; or when a marker shows up in a diff, a changelog or a tarball review.
---

# Leak scan

This repository is public and its packages are published to npm, so anything
committed or packed is disclosed. Three incidents in September 2026 proved that
the leak surface is wider than "examples in tests": compiled `lib/` strings that
the model reads, documentation prose inside the tarball, fixture data in the
public git history, chore-release changelogs, and a LAN address in a test.

The scanner in this skill implements the sweep. The two reference files carry
the details: `references/scan-recipes.md` for the per-surface commands and the
dictionary discipline, `references/incident-playbook.md` for what to do when
something already shipped.

## What counts as a leak here

| Category | Looks like | Where it hides |
|---|---|---|
| Tracker keys **and their numbers** | a project prefix plus an id, or a real id behind a placeholder prefix | examples, fixtures, JSDoc, specs |
| Internal hosts | a corporate FQDN or an internal service name | README, docs, provider config, tests |
| Private addresses | RFC1918 with a port, a stand URL | tests, specs, deployment notes |
| People | a real name, a login, an author in a fixture | fixtures, docs, review transcripts |
| Products and systems | a real product, system, module or database name | prose, tool descriptions, error strings |
| Internal code identifiers | domain class or field names lifted from real code | fixtures, examples |
| Credentials | any token, password, key or URL with userinfo | fixtures, docs, changelogs |
| Shipped prose | specs and notes under `docs/` that the manifest packs | npm tarball |

Two habits matter more than any pattern:

- **A number is part of the identifier.** Changing the prefix of a real key
  while keeping its sequence number removes nothing; the style here is a fully
  synthetic key such as `PROJ-123`.
- **Model-visible text counts.** Tool descriptions and error strings in `lib/`
  reach the model and the registry; a leak there is worse than in a comment.

## Boundaries

- In scope: everything tracked in `plugins/`, `packages/`, `tooling/`,
  `scripts/`, `docs/`, root files, plus the git history of every ref, plus the
  packed tarball of every publishable package.
- Out of scope by the user's own rule: the deployment kits (`qa-deploy/`,
  `qa-deploy-docker/`, `.portable/`). They live outside this repository and
  need the real values to work. Do not scrub them, do not copy them in.
- `test/` and `fixtures/` are **not** out of scope: fixture data ships in the
  public git history even when it never reaches a tarball.

## Quick start

```bash
S=.agents/skills/leak-scan/scripts/leak-scan.mjs

node "$S" --tree       # tracked + untracked files: what a commit publishes
node "$S" --history    # every blob reachable from any ref, with ref attribution
node "$S" --pack       # the file list npm would pack, per publishable package
node "$S" --all        # all three; exits 1 on any leak finding
```

Exit code is 1 when a leak-severity finding exists. Review findings (unknown
hosts, private addresses, name-shaped phrases, packed prose) print but do not
fail unless `--strict` is passed. Useful flags: `--only <prefix>` to narrow a
run, `--json` for machine output, `--hosts all` to also report local service
names, `--no-refs` to skip ref attribution.

A clean run prints `summary: 0 leak, 0 review` and exits 0. The tree and pack
surfaces are clean as of 2026-09-17; history is clean on `main` and on the
active feature branches but **not** on stale local refs — see the playbook.

## The marker dictionary

The list of values that must never appear here is itself sensitive, so it does
not live in this repository. The scanner reads, in order:

1. `--markers <file>`
2. `$LEAK_MARKERS`
3. `<repo>/.dsh-leak-markers.txt` (gitignored, for throwaway lists)
4. `~/.dsh-leak-markers.txt` — the canonical location

Format, one entry per line, `#` for comments:

```
value              literal, case-sensitive, matched as a substring
regex:<pattern>    regular expression
noisy:value        reported as review, for short tokens that match by chance
```

Markers are checked before the allowlist and always report a leak, so a real
hostname hidden behind a placeholder family (`*.corp`, `*.lan`) still gets
caught. Extend the dictionary whenever a new real value appears — that is the
one step that makes the next sweep better than this one. Derive a first cut
from the removed lines of a rewrite (`references/incident-playbook.md`), and
record **both cases** of a short token: a case-sensitive sweep once left a
lowercase mention behind.

## Synthetic conventions

The repository's placeholder families are allowlisted in `allowlist.txt`,
together with the public hosts and the intentional fixtures: `PROJ-123`,
`jira.example.corp`, `w.corp`, `git.example.com`, `company.atlassian.net`,
`198.51.100.46`, `Алиса`/`Боб`, `i.ivanov@example.com`, the SSRF fixtures in
`10.0.0.0/8`, and the redaction fixtures (`glpat-…`, `sk-ant-…`).

Keep new examples inside those families and no allowlist entry is needed. When
a finding is a legitimate fixture, add an exact allowlist entry with a comment
that says why — never a wildcard that would also hide a real value.

## Routine

- **Before committing examples, fixtures, docs, tests or a changelog:** run
  `--tree`. Cheap, and it is the moment the leak is still private.
- **Before a release:** run `--all`. The pack surface is what the registry
  publishes, and the history surface is what the clone publishes.
- **After a release:** spot-check the published tarball
  (`references/scan-recipes.md`), because a manifest can grow a `files` entry
  that nobody re-read.
- **After any incident:** add the new values to the dictionary and re-run
  `--all`; a scrub is only done when a scan with a *fresh* pattern set is clean.

## Traps worth remembering

- **gitleaks is not a leak gate.** It flags token shapes and misses
  identifiers, hosts, names and addresses entirely. It also flags the
  intentional redaction fixtures in `tests/`, so keep fixture tokens obviously
  fake (`glpat-abcdefghij…`, all one character class) and allowlist them here.
- **The compiler prints what the source says.** Marker hits inside `lib/` are
  real hits: the fix belongs in `src/`, then rebuild.
- **Source maps embed sources.** `lib/client.js.map` can carry whole vendored
  sources; the scanner reads maps for exactly that reason.
- **Changelogs and version plans are public.** A release note that explains
  *what* was removed from the examples discloses the leak a second time; write
  neutral notes.
- **Half a scrub is no scrub.** After a rewrite, verify with patterns that are
  *not* the dictionary — a post-check that reuses the dictionary proves nothing
  about what the dictionary forgot.
- **A published version cannot be quietly fixed.** Deleting a GitHub branch
  does not retract a tarball, an npm version or an old commit reachable by SHA.
  See `references/incident-playbook.md`.

## Not covered

The scanner matches text. It cannot judge whether a description, a diagram or a
changelog line reveals internal process, org structure or a customer. Read the
diff of anything user-visible with that question in mind; the scanner narrows
the surface, it does not replace the read.
