# Client side: bundle, remote namespaces, slots, cards, tokens

The browser bundle loads through the host's DSH-ModuleLoader, outside Node.
Everything below was confirmed by a broken surface, not by a green gate.

## Bundle identity and shape

- The bundle registers itself via the tsdown banner:
  `window.__ModuleLoader__.load({ id: "<full package name>", factory: (require) => {…} })`
  with `var module = { exports: {} }` intro and `return module.exports; } });`
  footer, `format: ["cjs"]`, `platform: "browser"`. The id must equal the full
  `package.json#name` including the `@yadsh/` scope (AGENTS.md; generator and
  its `verify-client-bundle.mjs` enforce it).
- Do not confuse it with `export const name` in `src/client/index.ts` — that
  is the CORDIS name of the host half (often short, matches the settings
  namespace). It must NOT be the scoped package name.
- The bundle must remain a classic script: no ESM `export` statements (the
  verify script asserts this).
- Served URL: `/plugins/<full-package-name>/client.js` — the scoped path, when
  you fetch it in integration checks.

## No Node builtins — the invisible killer

- Any `require("process")` / `require("buffer")` / `node:*` that lands in the
  bundle kills the whole loader entry: the page shows
  `Failed to load plugins`, the console says
  `client-modules: require("process") missed the module table …`, and the
  HOST LOG IS EMPTY. `pnpm check` is green throughout.
- Known trigger: dual-build packages whose `exports` pick a node build under
  CJS resolution (`yaml` was the incident). `resolve.conditionNames` /
  `mainFields` in tsdown do NOT change the outcome.
- The fix is architectural: keep Node-dependent parsing in host-only modules
  and give the client what it needs via a remote call. And audit the
  TRANSITIVE closure — the client imports browser-safe modules from `src/`
  too, and through them whole host-only layers leak in (the qa-surface
  config-layer incident).
- After build: `grep -c 'require("process")\|require("buffer")' lib/client.js`
  must be 0; keep a loop over `process|buffer|node:fs|node:path` (both quote
  styles) plus a banned-package check in `scripts/verify-package.mjs`.
- The only complete proof is a browser smoke
  (`node scripts/smoke-packed-dsh.mjs --browser` — packed harness + headless
  Chromium, not in CI). On mount timeout, print collected
  `pageerror`/console errors; keep `catch` rethrowing `{ cause: error }` or
  eslint `preserve-caught-error` fails `pnpm pack`.

## Client `inject` contract

- After `remote.$mount(contribution)`, the namespace is readable ONLY on a
  context that injected it: `await ctx.inject(['remote.<ns>'], (rc) => { … })`.
  Reading `ctx.remote.<ns>` from your own context throws
  `cannot get property "remote.<ns>" without inject` → the loader entry dies
  → the plugin disappears from the UI, host log clean (banner
  `failed to apply loader entry …`).
- Register slots INSIDE the inject callback. The callback re-runs when the
  namespace is revoked/re-granted — REPLACE the previous registration each
  iteration instead of adding a second one.
- Someone else's namespace is a separate service key (`remote.credentials` is
  not a field of `remote`): listing `'remote'` is not enough, the face must
  inject `'remote.credentials'` too.
- `dsh.client.inject` in package.json must name every harness client package
  whose face the client code reads; a plugin's own client face declares its
  services via `export const inject = [...]`. Missing entries = the same
  silent whole-plugin death. Gate idea: regex the built bundle for the inject
  array (done in web-fetch-authenticated's verify-package).
- Slot registration goes through `ctx.slots.inject(key, () =>
  ctx.slots.register({name, id, order, label, inject}, Component))`; the slot
  exists only while the parent section is declared — `register` on an
  undeclared slot throws.

## Settings cards and pages

- Entry point decision (AGENTS.md): `settings.plugin.item` ONLY for a card
  editing a real Host settings namespace (host settings directory is
  unavailable to non-loopback browsers — no card without a namespace);
  `settings.plugins.tab` for feature-owned pages backed by custom Remote
  services or UI that must work from a non-loopback browser.
- Cards registered in `settings.plugin.item` must use the shared shell: root
  is a direct `<li>` child of the host list with classes `dsh-plugin-card`,
  `--open` modifier, `__header` (full-width `<button type="button">` with
  `aria-expanded`), `__head-text`, `__name`, `__description`, `__badge`,
  `__chevron`, `__body`. The canonical shell CSS is in AGENTS.md — copy it
  verbatim, no plugin-specific borders/shadows/icons. Render the body only
  while open; no card if the settings namespace is unavailable.
- Chevron: inline SVG `viewBox="0 0 14 14"`, path `m3.5 5.25 3.5 3.5 3.5-3.5`,
  `currentColor`, round caps/joins, 180° rotation when open. Font glyphs
  (`⌄`, `▾`) are forbidden everywhere in the bundle — the card-contract gate
  (`scripts/verify-plugin-card-contract.mjs`, called from your
  `verify-package.mjs`) rejects them.
- A card plugin owes a verify script that runs the card contract against the
  BUILT bundle (hygiene gate checks the script's existence; see
  `plugins/dsh-doc-impact/scripts/verify-client-bundle.mjs` for the pattern).
- Settings pages render inside an 800px dialog with a ~556px content column:
  viewport media queries do not fire. Lay out from the container
  (`display:flex; flex-wrap:wrap` + `flex: 1 1 Npx` columns) and test by
  measuring `el.scrollWidth > el.clientWidth` at every level.
- No interactive control inside the card header button: a `role="switch"`
  inside `<button>` is invalid DOM and a keyboard trap — make toggle and
  selection sibling controls.

## Proving the card you just registered

The shell contract lives in AGENTS.md and the gates assert its *text*, so a
plugin can pass every gate with a card no user ever sees. The bullet above owns
the bundle half of this — the verify script runs the contract against the built
`lib/client.js`, and the hygiene gate proves only that the script exists — so
what follows is the half no gate covers, in order:

1. Rebuild first: a stale `lib/` answers for the previous build.
2. Prove it live on a stand (`qa-stand-run`): the card is present and it
   expands. The state comparison AGENTS.md asks for is a browser's job, and no
   gate gives it.

"Card is not visible" — check in this order, it is almost always one of these:

- **Stale bundle.** Fetch the served URL from §Bundle identity and shape and
  confirm it is the build you just made.
- **Wrong extension point.** Apply the entry-point rule above: a card that must
  answer from the LAN belongs on `settings.plugins.tab`. Misplaced is not
  broken.
- **No namespace.** A `settings.plugin.item` card renders nothing while its Host
  settings namespace is unavailable — and inventing an empty namespace to make a
  page appear is the forbidden shortcut the same rule names.
- **Dead loader entry.** See the `inject` contract above: the plugin disappears
  from the UI and the host log stays clean.

## Proving a UI change beyond the gates

No gate opens the page, so "green" is never evidence about layout:

- **Measure instead of eyeballing.** The overflow check is the one §Settings
  cards and pages already gives; walk it level by level, including inside the
  settings dialog that section explains. Add what it does not cover: overlapping
  rects, and the computed radius and type scale read against the token, not
  against a memory of the design.
- **Capture the states that can differ**: the states the card UI section of
  AGENTS.md asks you to compare against a first-party card — that section names
  them, this page does not copy the list — plus the empty, loading and refusal
  states of whatever you added.
- **Keep the artifacts, do not create them in a package.** Screenshots and
  measurements are round evidence: they go to the deployment's local notes, and
  nothing of the kind belongs under `plugins/*/` — §Packaging and docs layout in
  `release-and-gates.md` says why, and the tarball must not carry them either.
  Never delete evidence you did not produce (`shared-checkout` §7).
- **Report the artifact, not the verdict**: which state, which measurement,
  which file proves it.

## Styles and design tokens

- Unknown `var(--dsw-…)` invalidates the ENTIRE declaration at computed-value
  time: `border: 1px solid var(--wrong)` loses border AND color; `color`
  falls back to inheritance. No console error, ever.
- Known-dead names to avoid (real incidents): `--dsw-alias-label-on-brand`
  (correct: `--dsw-alias-label-primary-foreground`), `--dsw-shadow-l2`
  (correct: `--dsw-shadow-lv2`), `--dsw-label-tertiary` (dropped `alias-`),
  `--dsw-alias-bg-error` / `--dsw-alias-label-error` (theme has
  `state-error-primary/secondary`), `--dsw-alias-border-brand`,
  `--dsw-alias-bg-elevated`, `--dsw-font-family-mono`,
  `--dsw-alias-fill-tsp-secondary`.
- Hardening: collect every `var(--dsw-alias-*)` from the built bundle and
  require each name to exist in the DSH theme source
  (`packages/client/ui-theme/src/styles/design-platform.css` of the harness
  checkout) — implemented in dsh-qa-integrations' `verify-package.mjs`; copy
  it. Caveat: the deployed theme may be wider than a given checkout, so a
  "dead" verdict is finally proven on a live stand.
- `injectCardStyles(pluginName, css)` (from `@yadsh/dsh-plugin-kit/client`)
  keys `<style data-plugin="…">` by the NAME argument: two stylesheets under
  one name = the second is silently dropped. Use distinct keys
  (`CARD`, `CARD + "/panel"`) and assert in verify that both tables are in
  the bundle with different keys.
- Client code has NO host file logging — `@yadsh/dsh-plugin-log` is
  forbidden under `src/client/**` (logging gate enforces).
- Build plugin-specific controls from `--dsw-alias-*` tokens so light/dark/
  system themes stay coherent; hard-coded colors only for a narrow semantic
  state, never for surfaces or typography.
