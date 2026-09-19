# Gates, build order, packaging, release

## Gates map (what catches what)

`pnpm check` = lint → format → typecheck → test → build → verify → deps:check.
It does NOT run `tarball:verify`, `release:check`, or the browser smoke — run
those separately before pushing. Per-project equivalent (what CI's matrix
runs): `pnpm nx run-many -t lint typecheck test build verify
--projects=@yadsh/dsh-<name> --skip-nx-cache` plus
`pnpm tarball:verify:packages plugins/dsh-<name>` (takes a PATH, not a
package name).

| Gate | Catches |
| --- | --- |
| `pnpm verify:logging` | plugin must depend on `@yadsh/dsh-plugin-log` (exactly `workspace:^`, in `dependencies`) and import it somewhere in `src/**`; forbidden in `src/client/**`. Scans ALL `plugins/*` — no opt-out |
| `pnpm verify:packages` (hygiene) | canonical metadata (`repository{type,url,directory}`, `homepage`, `bugs.url`, scope `@yadsh/`, description naming DeepSeek Harness/DSH, canonical keywords `deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis` + feature words, lowercase, no dupes); required files exist AND are in `files` (`cordis.patch.yml`, `compatibility.json`, `LICENSE`, `README.md`); `exports["./package.json"]`; `types === exports["."].types` in the standard `lib/` layout; `compatibility.node === engines.node` verbatim; scripts contract (`lint`, `typecheck`, `test`, `build`, `verify` — nx derives targets from them); docs must NOT be in `files`; published README links must resolve inside the tarball (use absolute GitHub URLs for non-published docs); `plugins.json` matches manifests; every `.nx/version-plans/*.md` parses as Nx reads it (fence, known package, valid bump, changelog message); a qa-surface plan requires a newer `QaChangelog.tsx` entry; `dsh.client` ⇒ a script asserting the full-name registration; `settings.plugin.item` card ⇒ a script running the card contract |
| `pnpm deps:check` | plugins never become dependencies of shared packages; `@deepseek-ai/*` runtime packages are peers, not dependencies; no cross-package relative imports; includes `pnpm dedupe --check` — after touching dependencies run `pnpm install` (and `pnpm dedupe` if you removed one), or this gate reddens on a dirty lockfile |
| `pnpm tarball:verify` | gates 1–7 on the packed tarball: canonical metadata, `dsh.bundle.patch`, every declared `exports` subpath present in the tarball, clean `npm install`, bare-Node import smoke. Gate 5 is the ONLY gate that compares `exports` against the real build — a copied exports map pointing at a module you never had passes everything until this gate (first push/CI) |
| `pnpm release:check` | every publishable project with commits its newest reachable release tag does not cover carries a COMMITTED version plan |

## Build order (fresh checkout / worktree)

1. `packages/*` are NOT built by git (`lib/` is ignored). Build them with
   their own scripts, not nx: `cd packages/plugin-log && pnpm run build`
   (same for `plugin-kit`, `test-kit`; `config` and `plugin-scripts` have
   nothing to build). nx reports exit 0 without producing `lib/` — do not
   trust it; check `ls packages/plugin-log/lib`.
2. Then dependency plugins (if your plugin imports a workspace plugin — it
   should not — or a generator stage needs one, e.g. typert analysis needing
   `@yadsh/dsh-qa-surface` built), then your own `pnpm run build`.
3. Sanity: `find plugins packages -maxdepth 2 -type d -name lib | wc -l`
   (≈24 on a full tree).
4. Outside the main checkout (worktree, second clone) ALWAYS:
   `NX_DAEMON=false NX_SKIP_NX_CACHE=true` — the daemon and the cache are two
   independent channels that execute/restore work from ANOTHER checkout and
   report phantom success.
5. Order inside the plugin: build BEFORE verify/typecheck when verifiers read
   `lib/` (typert types, card contract, bundle greps). Stale `lib/` produces
   false green AND false red; the honest fresh-checkout emulation is
   `rm -rf plugins/*/lib packages/*/lib` then
   `pnpm nx run-many -t typecheck --skip-nx-cache`.

## Flaky vs broken

Under full parallel `pnpm check` on Windows, git-heavy tests (temp repos) and
timer tests can fail from load (EBUSY, hook timeouts, ms-precise assertions).
Criterion: if the failing package passes in an isolated rerun, it is a load
flake — rerun isolated, mention it; if it fails isolated too, it is a defect
in the test wiring — fix it, never write it off as flaky.

## Packaging and docs layout

- `files` carries only what an installed package needs: `lib`, `cordis.patch.yml`,
  `compatibility.json`, runtime data files (e.g. `capability-policy.json`),
  legal notices (`LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md` — MIT
  obligation for adapted code), `README.md`, and `docs/images/*` it embeds.
  NEVER `SPEC.md`, `CHANGELOG.md`, `ROADMAP.md`, `docs/**`, translations.
- Docs stay in the repo: one `SPEC.md` in the plugin root (the verify scripts
  read it from `../SPEC.md`), design/spec addenda in `docs/specs/<topic>.md`,
  working notes in `docs/INVESTIGATE.md`. Relative links in the published
  README to anything not in the tarball are dead links — the hygiene gate
  rejects them; use absolute
  `https://github.com/xarleyn/dsh-plugins/blob/main/<path>` URLs.
- New harness client package in `dsh.client.inject`: peer `catalog:dsh` +
  dev `catalog:dsh-dev`, entries in BOTH catalogs of `pnpm-workspace.yaml`,
  `pnpm install` (lockfile), the package in `dsh.client.inject`, and — if a
  SERVICE of it is read — the service name in the client face's `inject`.
- Shared code goes to `packages/*` (plugin-kit has client helpers like
  `injectCardStyles`, plus sqlite/retention helpers) — plugin-to-plugin
  dependencies are an anti-pattern `pnpm deps:check` enforces.

## Version plans and releases

- Format:

  ```markdown
  ---
  "@yadsh/dsh-<name>": minor
  ---
  Changelog paragraph (what the user gets; neutral wording).
  ```

- A plan is required for ANY publishable-package change — source, tests,
  client cosmetics, packaging. Plans of one package merge into the highest
  bump. The plan text IS the changelog entry nx generates.
- Missing plan = the feature never appears in any changelog (nx is silent).
  Broken fence = nx silently ignores the plan (no bump, no entry, not even
  counted). `pnpm verify:packages` validates plans the way Nx reads them.
- `pnpm release:check` reads COMMITTS: uncommitted work is invisible ("N
  path(s) … checked once committed") — a green run before committing proves
  nothing; recheck after. If the tree changed `pnpm-lock.yaml`, ALL projects
  turn "touched" locally and the check reddens for infrastructural reasons —
  CI guards this by comparing against release wave tags
  (`release/<date>`); locally, read the missing-list against your own
  projects only.
- Before adding a plan, check no plan for the package is already pending
  (several plans are fine, but the release eats them all at once).
- Releases run exclusively through the GitHub release workflow (Trusted
  Publishing; no npm tokens, no tag-driven publishing). One wave tag
  `release/<date>` per release run; publishing happens from packed tarballs
  prepared by the pipeline.
- After a release, plans are consumed (deleted) by the bot commit; new work
  needs new plans.

## Before you commit

- Leak sweep (public repo, npm-published): synthetic placeholders only
  (`PROJ-123`/`PROJ-456`, `jira.example.corp`, `«Демо-продукт»`); a number is
  part of the identifier (renaming a prefix changes nothing); marker classes
  per AGENTS.md: ticket keys `[A-Z]{3,10}-[0-9]+`, corporate hosts, RFC1918
  with real ports, person names/logins. Deployment kits (`qa-deploy*`,
  `.portable/`) are exempt — never scrub them.
- Model-visible text counts: tool descriptions and error strings in `lib/`
  ship to npm and reach the model.
- Changelog/plan texts are public and permanent: neutral wording, never
  explain that something internal was removed or renamed.
- Run prettier (`pnpm format` / `pnpm format:write`) — a root-level
  `.prettierrc` covers all new files, and `pnpm check` fails on format before
  anything else. Note: regenerated `CHANGELOG.md` files may be unformatted
  after a release bot commit — that is tooling noise, check your own files
  with `prettier --check <file> --end-of-line auto`.

## Commit

- One feature = one `feat(dsh-<name>): …` commit with everything (code,
  tests, gate updates, README/SPEC, version plan, regenerated `plugins.json`).
  Body: 4–6 paragraphs — what is included, key decisions and why, what is
  deliberately deferred, what changed in shared layers.
- Docs-only: `docs(dsh-<name>): …`. No `!:` breaking marker — the bump comes
  from the plan; explain the break in the body.
- Stage explicit paths; assert the staged file count before committing:
  `git add <paths> && [ "$(git diff --cached --name-only | wc -l)" -eq N ] && git commit …`.
  `git add` with at least one nonexistent pathspec adds NOTHING (silently,
  if stderr is swallowed) — never mix existing and nonexistent paths, never
  mute its stderr.
- After a commit of published-content changes, rerun
  `pnpm verify:packages` and `pnpm release:check` on the committed tree —
  both read commits, not the worktree.
