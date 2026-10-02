---
name: leak-guard
description: Keep this public repository and its npm packages free of internal
  identifiers — real tracker keys with their numbers, internal hosts and
  addresses, personal names, product names, and credentials. Documents the audit
  method (what counts as a leak, which surfaces a sweep covers, how a marker
  dictionary and an allowlist interact, which habit catches what a pattern
  cannot) and the aftermath of something that already shipped. Use before
  committing examples, fixtures, specs, docs, changelogs or version plans; before
  a release; when a marker appears in a diff or a tarball review; and whenever a
  note is tempted to explain what was removed from public text.
---

# Leak guard

This repository is public and every package under `plugins/` and `packages/` is
published to npm. Anything committed, packed or reachable from a ref is
disclosed, and a disclosure cannot be quietly taken back: deleting a branch does
not retract a tarball, an npm version, or a commit still reachable by its SHA.

This skill is the **method**. The sweep itself runs from tooling that is not part
of the public tree, and the list of values that must never appear here is itself
sensitive, so it lives outside the repository and is passed to the scanner rather
than committed to it. Where this text repeats a rule another document owns, that
document stays normative: the synthetic-identifier conventions (`PROJ-123`,
`jira.example.corp`, `Демо-продукт`, and the ban on a release note that names what was
removed) are `AGENTS.md` §No internal identifiers, and the sweep that runs before a
publish belongs to the `release-plugins` skill. What this file adds is the reading —
why a family is a mask, and which surface a leak ships through.

## What counts as a leak

| Category | Looks like | Where it hides |
|---|---|---|
| Tracker keys **and their numbers** | a project prefix plus an id, or a real id behind a placeholder prefix | examples, fixtures, JSDoc, specs |
| Internal hosts | a corporate FQDN or an internal service name | README, docs, provider config, tests |
| Private addresses | a private-network address with a port, an internal stand URL | tests, specs, deployment notes |
| People | a real name, a login, an author in a fixture | fixtures, docs, review transcripts |
| Products and systems | a real product, system, module or database name | prose, tool descriptions, error strings |
| Internal code identifiers | domain class or field names lifted from real code | fixtures, examples |
| Credentials | any token, password, key or URL carrying userinfo | fixtures, docs, changelogs |
| Shipped prose | specs and notes under `docs/` that the package manifest packs | npm tarball |

Two habits matter more than any pattern.

- **A number is part of the identifier.** Changing the prefix of a real key while
  keeping its sequence number removes nothing. The convention here is a fully
  synthetic key such as `PROJ-123`.
- **Model-visible text counts.** Tool descriptions and error strings compiled into
  `lib/` reach the model and the package registry; a marker there is worse than the
  same marker in a comment.

## The surfaces a sweep has to cover

1. **The working tree** — tracked files plus untracked ones the repository has not
   ignored: this is what the next commit publishes. Ignored paths are outside it, so a
   `lib/` that has never been built is not covered here; the built artifact is what the
   packed surface reads.
2. **The git history** — every blob reachable from any ref, with ref attribution.
   A fixture removed yesterday is still public today.
3. **The packed tarball** — the file list npm would publish for each package. A
   manifest can grow a `files` entry nobody re-read, and `docs/` prose and `lib/`
   strings ship inside it.

A sweep reports two severities. A **leak** is a known value that must never appear
and fails the run. A **review** finding is a shape that is usually internal — an
unknown host, a private-network address, a name-shaped phrase, prose that will be
packed — and is reported for a human to judge. Review findings that are legitimate
fixtures are recorded individually in the allowlist; they are never silenced with a
wildcard that would also hide a real value.

## Marker dictionary and allowlist

The dictionary is a private file of **values**, passed to the scanner by path or by
environment; it is never committed. This document describes the method without
reproducing that file — where it sits on disk is not the secret, the values are, and the
operator's own runbook names its location. Its format is one entry per line:

```
value               literal; six characters or longer match as a substring
regex:<pattern>     regular expression
noisy:value         reported as review, for a short token that matches by chance
noisy-regex:<p>     the same, for a pattern too loose to report as a leak
```

A literal shorter than six characters is matched on word boundaries rather than as a
substring — `qa` would otherwise report every word that contains it — so a short marker
is a whole-word marker, and a marker whose parts are glued together needs the `regex:`
form.

Order matters and is the whole point: **markers are checked before the allowlist and
always report a leak**, so a real hostname dressed in a placeholder family
(`*.corp`, `*.lan`) is still caught. Consequences worth remembering:

- Case matters. Record **both cases** of a short token: a case-sensitive sweep misses
  the lowercase mention of a value whose uppercase form was caught.
- A first cut of the dictionary is derived from the removed lines of a rewrite, not
  invented from memory.
- Extend the dictionary whenever a new real value appears. That is the one step that
  makes the next sweep better than this one.
- After a scrub, verify with patterns that are **not** the dictionary. A post-check
  that reuses the dictionary proves nothing about what the dictionary forgot.

The allowlist holds no real value: it is a list of **placeholder shapes**, and it is
read after the dictionary, so it can never hide a marker. Two of the families below are
not allowlist entries at all but rules built into the scanner, and the distinction
matters when a sweep behaves differently from this text:

- decided by rules inside the scanner, not by allowlist entries: the private-use ranges
  (RFC 1918 and the CGNAT block) are reported on their own — as a review item, because a
  bare internal address is most often test scaffolding, and it becomes a leak only when a
  dictionary marker names that address specifically; the link-local metadata addresses
  the SSRF fixtures deliberately aim at (`169.254.169.254`) pass as fixtures;
- reserved documentation domains and pseudo-TLDs — `example.com` and its siblings,
  `*.example.*`, `*.test`, `*.invalid`, the `*.corp` / `*.internal` / `*.local`
  families, and `127.0.0.1`;
- RFC 5737 documentation addresses — both `198.51.100.0/24` and `203.0.113.0/24`,
  because the tests were written against the second one more often than the first;
  these are *not* covered by the private-use rule and do need entries;
- public service hosts that appear as tool links in docs (a VCS host, a package
  registry, a vendor's API domain);
- the synthetic ticket convention: a made-up prefix **and** a made-up number,
  `PROJ-123`;
- the placeholder product name the repository's own rules prescribe, `Демо-продукт`;
- person placeholders, recorded **by exact value**.

A host under `.localhost` is worth naming exactly: the scanner's own entry is the bare
`localhost`, so `http://svc.localhost:8080` arrives as a review finding until someone
decides whether that host is a placeholder or a real machine on the network.

Everything else needs an exact allowlist entry with a comment saying why. **A
credential fixture is allowlisted against the list of fake values, never against the
shape of a token**: `glpat-` and `sk-ant-` prefixes are shared with the real thing, so
"anything that looks like a token of this shape" is a mask that would also swallow a
leaked one. In practice one anchored pattern over two committed fixtures
(`glpat-abcdefghij0123456789`, `sk-ant-very-secret-value`) is the maintenance-free form
of that list — what makes it safe is that the pattern was written *from the values*, and
it stops being safe the moment it starts matching tokens nobody declared.

Staying inside these families needs little or no allowlist edit; anything outside them
needs an entry, and a sweep that reports a finding this text said would be silent is a
reason to read the scanner, not to widen a pattern.

## Routine

- Before committing examples, fixtures, docs, tests, a changelog or a version plan —
  sweep the working tree. It is cheap, and it is the moment the leak is still private.
- Before a release — sweep all three surfaces. The pack surface is what the registry
  publishes; the history surface is what the clone publishes.
- After a release — spot-check the published tarball.
- After an incident — add the new values to the dictionary and re-run everything. A
  scrub is finished when a sweep with the *fresh* pattern set is clean, not when the
  edit is done.

## Traps

- **A secret scanner is not a leak gate.** Tools tuned to token shapes flag credential
  syntax and miss identifiers, hosts, names and addresses entirely; they also flag the
  intentional redaction fixtures in `tests/`. Keep fake tokens obviously fake and
  allowlist them by exact value.
- **The compiler prints what the source says.** A marker hit inside `lib/` is a real
  hit whose fix belongs in `src/`, followed by a rebuild.
- **Source maps embed sources.** A `*.js.map` can carry whole vendored files, so the
  sweep reads maps rather than only the bundle.
- **Changelogs and version plans are public, and explaining a removal is a second
  disclosure.** A release note that says what was taken out of the examples tells the
  reader the leak existed. Write neutral notes about the present behaviour.
- **Deployment kits are out of scope by design.** The local kits need the real values
  to function; they live outside this repository, are not scrubbed, and their content
  is not copied in.

## What the sweep cannot do

Matching is textual. A description, a diagram or a changelog line can reveal internal
process, org structure or a customer without containing any dictionary value. Read the
diff of anything user-visible with that question in mind: the sweep narrows the
surface, it does not replace the read.
