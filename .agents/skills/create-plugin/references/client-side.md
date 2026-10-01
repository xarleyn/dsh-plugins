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
  ctx.slots.register({name, …}, Component))`; the slot exists only while the
  parent section is declared — `register` on an undeclared slot throws. A *list*
  seat is addressed by `{id, order, label}`, a *keyed* seat by `{key}` instead of
  that half; `locale` and `inject` travel with either. Passing the wrong half is
  a silent misplacement, not an error.

## Configuration cards on the Plugins panel

- Entry point (AGENTS.md): a plugin's configuration card registers on the Host
  Plugins page, in the `plugins.row.config` seat of its own bundle row. The seat
  is keyed `@yadsh/dsh-<name>#<row id>`, where the row id is the `id` this
  bundle's `cordis.patch.yml` declares — and that id is also the settings
  namespace the Host resolves the volatile Config under, so the key invents no
  name and a value saved before the seat existed still reads back.
  `settings.plugin.item` was deleted at `0.1.7`; `settings.plugins.tab` is not a
  card's registration point any more.
- The shape, registered inside `ctx.inject(['slots', 'configForms', …], …)` so a
  revoked/re-granted namespace re-registers instead of stacking:

  ```tsx
  const ROW_CONFIG_KEY = `@yadsh/dsh-<name>#${SETTINGS_NAMESPACE}`;

  ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      { name: "plugins.row.config", key: ROW_CONFIG_KEY, inject: () => face },
      MyEntry,
    ),
  );
  ```

  The panel titles the row from the package manifest, so no `label` is handed to
  the seat and a keyed seat has no `order`.
- From `@yadsh/dsh-plugin-kit/client` a row card keeps `bindSettingsExternalStore`,
  `startVisibilityAwarePolling` and `injectCardStyles`. `CardShell`,
  `PLUGIN_CARD_SHELL_CSS` and `ChevronDown` belong to a card that owns its shell —
  a `settings.section` or `settings.plugins.tab` page — and must NOT be imported by
  a row card: the Plugins page draws the frame, the heading and the expand control,
  so ours would be a second card inside the Host's one.
  `registerSettingsCard` / `SETTINGS_PLUGIN_ITEM_SLOT` default to the slot the
  Host deleted at `0.1.7` — pass `slotName: "plugins.row.config"` with the row
  `key`, or drive `ctx.slots.inject`/`register` yourself, which is what every
  migrated plugin of this repository does.
- The page seats the same entry under two `view`s: `summary` — a one-liner
  wherever a row declares no description of its own — and `page`, the card.
  Export an entry that answers `summary` with the sentence and mounts the card
  only for `page`; a card inside a line of text draws a page within a paragraph
  and starts a second poll of the Remote.
- The seat passes its own owner prop `form`: a `ConfigPageForm` of
  `{ state, mutate }` only — no subscription, no single-field `set`/`unset`, and
  `undefined` when no Config field carries `.volatile()`. The renderer spreads
  the owner props AFTER the injected face, so a face member named `form` is
  overwritten and the card dies against a `mutate` that is not a `ConfigForm`.
  Resolve what the card really needs through `ctx.configForms.get<T>(namespace)`
  and pass it in the face under another name (`settingsForm`, what the migrated
  plugins settled on).
- The shell contract (AGENTS.md) is decided by the seat, and the gate reads the seat
  off the built bundle. On `plugins.row.config` the canonical CSS, the
  `dsh-plugin-card` classes and the inline chevron are what the gate **rejects**: the
  page supplies the frame, the title, the row id and the description line, and mounts
  the `page` view inside them. Take the focus ring from the Host's tokens
  (`--dsw-focus-ring-width` / `--dsw-focus-ring-color`, with a fallback length on the
  width) instead of writing your own `outline`. Keep answering `unavailable` visible:
  a card that owns its shell may render nothing, but a body inside the page's card
  owes a sentence, or the reader gets an empty section; disable writes from
  `state.writable` rather than hiding the controls — a LAN browser does
  reach the Plugins page, which is not the loopback-gated settings directory.
- The manifest follows the surface. The client half type-imports the slot
  contract of `@deepseek-ai/dsh-client-ui-plugin-manager`, so that package
  replaces `@deepseek-ai/dsh-client-ui-settings-plugins` in `peerDependencies`,
  in `devDependencies` (both through the `dsh` / `dsh-dev` catalogs) and in
  `dsh.client.inject`; `compatibility.json` names `plugins.row.config` among its
  `requiredClientFeatures`. A host without the Plugins page loses the card, so
  the bump is a `minor`, not a patch.
- Chevron: inline SVG `viewBox="0 0 14 14"`, path `m3.5 5.25 3.5 3.5 3.5-3.5`,
  `currentColor`, round caps/joins, 180° rotation when open. Font glyphs
  (`⌄`, `▾`) are forbidden everywhere in the bundle — the card-contract gate
  (`scripts/verify-plugin-card-contract.mjs`, called from your
  `verify-package.mjs`) rejects them.
- A card plugin owes a verify script that runs the card contract against the
  BUILT bundle (hygiene gate checks the script's existence; see
  `plugins/dsh-model-safety-gate/scripts/verify-package.mjs` for the pattern).
- A page mounted in the native settings tree (`settings.section`, as
  `dsh-preset-persona-editor` does) renders inside an 800px dialog with a
  ~556px content column: viewport media queries do not fire. Lay out from the
  container (`display:flex; flex-wrap:wrap` + `flex: 1 1 Npx` columns) and test
  by measuring `el.scrollWidth > el.clientWidth` at every level.
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
- **Wrong seat.** Apply the entry-point rule above: a configuration card is the
  `plugins.row.config` seat of its own row, and a key that is not
  `<package name>#<row id>` — a short id, a missing `@yadsh/` scope, a row id
  that does not match the `id` in `cordis.patch.yml` — seats the card where the
  page never renders it. Misplaced is not broken.
- **Summary, not page.** The page may be holding your entry as the row's
  `summary` one-liner until the row is opened. An entry that answers `summary`
  with a sentence shows nothing until then; that is the seat working as
  documented, not a dead card.
- **No namespace.** The seat hands no `form` while the Config declares no
  `.volatile()` field, and the card renders nothing while the namespace answers
  `unavailable` — inventing a field to make a surface appear is the forbidden
  shortcut the entry-point rule names.
- **Dead loader entry.** See the `inject` contract above: the plugin disappears
  from the UI and the host log stays clean.

## Proving a UI change beyond the gates

No gate opens the page, so "green" is never evidence about layout:

- **Measure instead of eyeballing.** The overflow check is the one
  §Configuration cards on the Plugins panel already gives; walk it level by
  level, including inside the 800px settings dialog a `settings.section` page
  renders into. Add what it does not cover: overlapping
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
