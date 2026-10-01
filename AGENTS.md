# Repository instructions

## Verification before completion

- Before finishing a task, run the checks relevant to the changed scope.
- For code changes, run the available tests, linter, type checker, build, and
  package or integration verification when applicable. Prefer the repository's
  combined check command when it covers the affected code.
- Do not claim that a task is complete while a relevant check is failing.
  If a check cannot be run, state which check was skipped and why.
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

### Choosing the registration point

- A plugin's configuration card registers in the Host's **Plugins** panel, on
  the `plugins.row.config` seat of this bundle's own row. The seat is keyed
  `<package name>#<row id>`, where the row id is the `id` the bundle's
  `cordis.patch.yml` declares. That row id is also the settings namespace the
  Host resolves the volatile Config under, so a seat move never orphans a saved
  value.
- A feature-owned page — backed by custom Remote services or account/session
  state rather than by this bundle's settings namespace — takes the panel's
  bundle-level seat, `plugins.bundle.config`, keyed by the package name. That
  seat renders no form at all, which is why a configuration card uses the row
  seat and resolves its own form.
- Do not register a configuration card in the Settings dialog. The
  `settings.plugin.item` slot was deleted in `0.1.7`, and `settings.plugins.tab`
  — a tab of the native Plugins settings section — is not a registration point a
  plugin of this repository adds to, even though the Host still ships that slot.
- The Plugins panel is not the settings directory, so a card seated there keeps
  answering from a non-loopback browser, where the settings directory is
  intentionally unavailable. Read `state.status` and `state.writable` off the
  form and disable the write controls instead of hiding the card.
- The seat hands its registrant two views: `view: 'page'` is the card, and the
  same entry is seated as `view: 'summary'` wherever the page wants a one-liner
  for a row that declares no description. Answer the summary with that sentence
  and mount the card only for `page` — a card inside a line of text draws a page
  within a line and polls its Remote twice.
- Alongside the injected face the seat passes its own owner prop named `form`: a
  `ConfigPageForm` of `{ state, mutate }` only, which can neither be subscribed
  to nor written field by field, and which is `undefined` when the Config
  declares no `.volatile()` field — a page that edits nothing says so, it does
  not invent a field to make a surface appear. The renderer spreads the owner
  props after the face, so a card that needs the full `ConfigForm` resolves it
  through `ctx.configForms.get<T>(namespace)` and passes it in its face under a
  name other than `form`.
- Use `settings.section` for a page that is mounted inside the native settings
  tree, as `dsh-preset-persona-editor` does. It is a placement choice, not an
  availability guarantee: a page that must keep working without the native
  settings surface belongs on the Plugins panel. A page registered here
  that reuses the standard card shell keeps its `<li>` root inside a
  plugin-owned `<ul>`.

### Two kinds of card: who owns the chrome

- On the Plugins panel, `plugins.row.config` seats the card inside the Host's own
  row-detail page. The page draws the card surface (a `--dsw-radius-xl`, 20 px
  radius), the row title, the row id, the module name and the description line, and
  only then mounts the registrant's `page` view under the page's configuration
  section. A card seated here renders **the body only**: no outer border, no
  background of its own, no `<li>` root, none of the `dsh-plugin-card*` classes and
  no chevron of ours. Repeating the chrome inside the Host's card draws a second
  frame and a second heading next to the first-party rows, which is what this rule
  exists to prevent.
- The same bundle still answers the `summary` view of its own seat, and that answer
  lands inside the Host's description paragraph: one plain sentence, never a card.
- Focus treatment on this surface is the Host's, from its ring tokens:
  `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`.
  A `:focus-visible` rule of our own with a hard-coded outline loses to the Host's
  `focus.css` (specificity 0-3-2 against 0-2-0) under pointer modality, so raising
  our specificity is the wrong repair — take the tokens.
- The seat key `<package name>#<row id>` and the settings namespace it resolves are
  not part of the chrome. Moving them orphans the values a user already saved, so a
  chrome change never touches them.
- A page mounted in the native settings tree (`settings.section`), or in a tab of
  the native settings surface (`settings.plugins.tab`) — a placement this repository
  is moving away from, not one a new card chooses — still owns its whole card:
  nothing around it draws a frame. Such a card's root is a `<li>` rendered inside a
  plugin-owned `<ul>` — not an `<article>` and not a permanently expanded custom
  panel.
- For a card that owns its shell, use the shared BEM class contract:
  `dsh-plugin-card`, `dsh-plugin-card--open`,
  `dsh-plugin-card__header`, `dsh-plugin-card__head-text`,
  `dsh-plugin-card__name`, `dsh-plugin-card__description`,
  `dsh-plugin-card__badge`, `dsh-plugin-card__chevron`, and
  `dsh-plugin-card__body`. Keep plugin-specific class names inside the body.
- Keep the shell rules identical in every self-contained client bundle that owns its
  shell. Do not add a plugin-specific border, shadow, gradient, header icon, title
  size, or hover treatment. The canonical shell CSS is:

  ```css
  .dsh-plugin-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
  .dsh-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}
  .dsh-plugin-card--open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
  .dsh-plugin-card__header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
  .dsh-plugin-card__header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
  .dsh-plugin-card__head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
  .dsh-plugin-card__name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
  .dsh-plugin-card__description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
  .dsh-plugin-card__badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
  .dsh-plugin-card__chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
  .dsh-plugin-card--open .dsh-plugin-card__chevron{transform:rotate(180deg)}
  .dsh-plugin-card__body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
  ```

- The header of a card that owns its shell is a full-width `<button type="button">`
  with `aria-expanded`, an accessible show/hide label, the title and description
  stack, an optional status badge, and the chevron in that order. Render the body
  only while open. While the row's namespace answers `unavailable`, render no card.
- A card that owns its shell uses a 14 by 14 inline SVG chevron with
  `viewBox="0 0 14 14"` and the path
  `m3.5 5.25 3.5 3.5 3.5-3.5`, stroked with `currentColor`, round caps, and
  round joins. Do not use font glyphs such as `⌄` or `▾`; their shape and
  baseline vary by font and encoding.
- Build plugin-specific controls from `--dsw-alias-*` design tokens so light,
  dark, and system themes stay coherent. Hard-coded colors may communicate a
  narrow semantic state, but must not define the card surface or typography.
- Package verification for a configuration card is decided by the seat the bundle
  registers on, and the seat is read off the built bundle rather than declared by the
  plugin. A card that owns its shell (`settings.section`, `settings.plugins.tab`) must
  show the standard shell class and the SVG path in the built client bundle, and must
  reject legacy outer-shell classes, font chevrons and non-standard shell tokens. A
  card seated on the Plugins panel row (`plugins.row.config`) must show **neither** —
  any `dsh-plugin-card*` class or our chevron path there is the second frame this rule
  forbids. Only a registration names a seat: a mention in a tooltip, an error string or
  a surviving comment must not switch the contract. A package that publishes the shell
  for others to inline, and registers nothing itself, is held to the canonical shell
  half directly (`verifyCanonicalShell`). When a local DSH web app is available,
  visually compare the card with a first-party one: closed, hovered, focused and open
  for a card that owns its shell, and the row's own states — collapsed, expanded,
  focused after a mouse click — for a card that does not.

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
