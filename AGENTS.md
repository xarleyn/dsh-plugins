# Repository instructions

## Verification before completion

- Before finishing a task, run the checks relevant to the changed scope.
- For code changes, run the available tests, linter, type checker, build, and
  package or integration verification when applicable. Prefer the repository's
  combined check command when it covers the affected code.
- Do not claim that a task is complete while a relevant check is failing.
  If a check cannot be run, state which check was skipped and why.
- Re-counting the head of a branch after a batch of merges includes lint of the
  whole line — `pnpm lint:workspace` and
  `NX_DAEMON=false pnpm nx run-many -t lint --skip-nx-cache` — because a
  tooling package of this repository declares a `lint` target only, so a set of
  build/test/verify passes over it without running a task and still exits 0.
  Judge that run by its `Successfully ran target lint for N projects` line, not
  by its exit code. The set, its reason and the ban on widening the
  `no-useless-escape` exemption are in `docs/VERIFICATION.md`, §Re-counting the
  line after a batch of merges.
- Report the exact verification commands and their results in the final
  handoff.

## CI workflows stay GitHub-shaped

- The public GitHub Actions run is the release pipeline: it publishes the
  packages and gates the wave. A Gitea Actions mirror run is a convenience copy
  on a self-hosted runner and has no authority over the shipped artifact.
- Therefore the shape of `.github/workflows/*` is defined by what GitHub needs.
  Do not restructure a matrix, a job split, or an artifact name to work around a
  Gitea Actions limitation, even when the mirror run is red or oversized because
  of it. Fix the mirror on the mirror's side (runner capacity, the status the
  board assigns to mirror runs) or ask the owner.
- Adding a step, or making a step's condition depend on the event type, stays
  within GitHub's shape and is fine. Replacing
  `matrix: ${{ fromJSON(needs.prepare.outputs.matrix) }}` with a fixed bucket
  list, so that a host which cannot expand it still fans out, is not.
- A mirror run that fails for reasons the changed code does not cause is not a
  blocker for the pull request: mark the pull request `ci-external` and say
  which run and job were examined. Do not "fix" such redness by weakening the
  workflow's checks on main.
## File size budget

- A source file under `plugins/*/src`, `packages/*/src`, `plugins/*/scripts` or
  `packages/*/scripts` must stay within 1400 lines (1200 warns) and a file under
  `plugins/*/tests` or `packages/*/tests` within 900 (700 warns); a generated
  bundle under a package's `lib/` is held to a runaway line limit only, and no
  budget is measured in bytes. The repository root's `scripts/` is outside the
  measured scope until a card splits it. The thresholds, the scope and the
  reason of every exemption are in `docs/VERIFICATION.md`.
- `scripts/check-file-budget.mjs`, run as `pnpm check:files`, carries the files
  that were already over budget when the gate landed, each with its reason on the
  same line, and that list only shrinks: split the oversized file instead of
  raising a threshold or adding a path to it. Growing an allowlisted file is
  neither an error nor a warning — the refactor cards own those paths — but every
  entry is printed as `allowlisted: <path> — <reason>` in each run, so an
  exemption is never invisible.

## QA surface release notes

- Every user-visible `@yadsh/dsh-qa-surface` change that adds or updates an Nx
  version plan must also update
  `plugins/dsh-qa-surface/src/client/components/QaChangelog.tsx` for the
  planned version in the same change. Do not bump `package.json` manually; Nx
  materializes the version during release.

## Browser client module identity

- Every package that declares `dsh.client` must ship a classic browser bundle
  that registers itself through `window.__ModuleLoader__.load({ id, factory })`.
- The registration `id` must exactly equal the package's full
  `package.json.name`, including its npm scope. Do not use the Cordis patch id,
  the plugin directory name, or an unscoped shorthand.
- Client bundle and packed-package verification must assert the full package
  name. When an integration check fetches a bundle, use
  `/plugins/<full-package-name>/client.js`, preserving the scoped path.

## Plugin configuration card UI

| Placement | Registration and rendering |
| --- | --- |
| A row's own Host Config | Register `plugins.row.config` at `<package name>#<cordis row id>`. Preserve its settings namespace. Render only the body for `page` and a plain sentence for `summary`. The Host draws the row, frame and heading. |
| A feature page for the whole bundle | Register `plugins.bundle.config` under the full package name. This seat supplies no configuration form. |
| Native settings page | Use `settings.section` for an intentionally native page. A card that owns its shell uses the canonical accessible button, SVG chevron and `<li>` inside its own `<ul>`. |

Use the form's status and writable state on the current Host. Resolve a full ConfigForm with ctx.configForms.get(namespace) under a prop other than form. New cards belong on the Plugins panel. Export and ship locale/en.json with English meta.title and meta.description. Follow [.agents/skills/create-plugin/references/client-side.md](.agents/skills/create-plugin/references/client-side.md) for the canonical shell, focus tokens and seat-specific bundle checks. Verify the packed client and the relevant interaction states.

## No internal identifiers in public content

- The repository is public and every package publishes to npm. Examples,
  fixtures, specs, tool descriptions, error messages and READMEs must use only
  synthetic placeholders: `PROJ-123`/`PROJ-456`, `jira.example.corp`,
  «Демо-продукт». Never real task numbers under a renamed prefix, internal
  hosts, LAN addresses, project keys, product names, or people's names.
- Test fixtures ship in public git history even when they do not ship in
  tarballs; `lib/*.js` strings and anything in the package `files` list ship
  to npm.
- Release notes must not reveal that a leak existed ("no longer names an
  internal Jira project" is itself a disclosure).
- Before committing anything naming a project, host, task or person, grep for
  marker classes: ticket keys `[A-Z]{3,10}-[0-9]+`, corporate hosts,
  RFC1918 addresses with real ports, person names and logins.
- Exempt: `qa-deploy/`, `qa-deploy-docker/`, `.portable/` kits.
- The audit method behind these rules — what counts as a leak, which surfaces a sweep
  covers, how the marker dictionary and the allowlist interact, and what to do after
  something shipped — is written up in `.agents/skills/leak-guard/SKILL.md`. The report
  of an actual sweep stays out of the public tree: the method is reproducible, the
  findings are not a public artifact.
