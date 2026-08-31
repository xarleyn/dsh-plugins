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

- Cards registered in `settings.plugin.item` must use the same outer shell as
  the first-party DSH plugin cards. The root is a direct `<li>` child of the
  host list, not an `<article>` or a permanently expanded custom panel.
- Use the shared BEM class contract for the shell:
  `dsh-plugin-card`, `dsh-plugin-card--open`,
  `dsh-plugin-card__header`, `dsh-plugin-card__head-text`,
  `dsh-plugin-card__name`, `dsh-plugin-card__description`,
  `dsh-plugin-card__badge`, `dsh-plugin-card__chevron`, and
  `dsh-plugin-card__body`. Keep plugin-specific class names inside the body.
- Keep the shell rules identical in every self-contained client bundle. Do not
  add a plugin-specific border, shadow, gradient, header icon, title size, or
  hover treatment. The canonical shell CSS is:

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

- The header is a full-width `<button type="button">` with `aria-expanded`, an
  accessible show/hide label, the title and description stack, an optional
  status badge, and the chevron in that order. Render the body only while open.
  If the settings namespace is unavailable, render no card.
- Use a 14 by 14 inline SVG chevron with `viewBox="0 0 14 14"` and the path
  `m3.5 5.25 3.5 3.5 3.5-3.5`, stroked with `currentColor`, round caps, and
  round joins. Do not use font glyphs such as `⌄` or `▾`; their shape and
  baseline vary by font and encoding.
- Build plugin-specific controls from `--dsw-alias-*` design tokens so light,
  dark, and system themes stay coherent. Hard-coded colors may communicate a
  narrow semantic state, but must not define the card surface or typography.
- Package verification for a configuration card must assert the standard shell
  class and SVG path in the built client bundle and reject legacy outer-shell
  classes, font chevrons, and non-standard shell tokens. When a local DSH web
  app is available, visually compare closed, hovered, focused, and open states
  with a first-party card before completion.
