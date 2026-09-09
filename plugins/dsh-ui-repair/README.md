# dsh-ui-repair

![Status: proof of concept](https://img.shields.io/badge/status-proof%20of%20concept-yellow.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

An early, conservative compatibility layer for visual problems in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin
interfaces. It measures rendered DOM, reports narrowly defined layout
anomalies, and can apply reversible scoped CSS without editing another
plugin's source or package files.

[Full specification](<dsh-ui-repair — спецификация плагина.md>) ·
[DSH integration investigation](INVESTIGATE.md)

## Current proof of concept

This first implementation slice includes:

- an installable Host package and classic DSH browser bundle;
- semantic repair roots instead of coupling to hashed CSS-module classes;
- `R001` repeated-row icon alignment diagnostics;
- `R002` repeated-row icon size consistency diagnostics;
- `R005`/`R006` unexpected horizontal and vertical overflow diagnostics;
- `R007` clipped-content diagnostics;
- `R008` flex-shrink and `R009` missing-min-width diagnostics;
- `observe`, `suggest`, and conservative `auto` runtime modes;
- persistent Host settings and a standard Plugin Configuration card;
- persistent selector/plugin/rule ignore policies;
- allowlisted CSS writes scoped by per-repair data attributes;
- animation-frame layout stabilization, verification, and rollback;
- in-memory repair history;
- bounded initial scans and mutation-triggered targeted rescans;
- automatic restoration of every owned DOM attribute and style tag on unload.

The default mode is `observe`. Configuration is persisted by the DSH settings
section under the `ui-repair` namespace. Generic overflow is reported but not mutated.
An overflow target must opt in with `data-dsh-ui-repair-scroll` before the
current auto mode can treat it as a safe scroll owner.

## Repair roots

The scanner recognizes these stable boundaries:

```text
[data-dsh-ui-repair-root]
[data-dsh-plugin-root]
[data-plugin-root]
[data-slot="settings.plugin.item"] > *
[role="dialog"][aria-modal="true"]
```

Plugin authors can make a fixture or owned surface unambiguous:

```html
<section data-dsh-ui-repair-root="example-plugin">
  <div data-dsh-ui-repair-scroll>...</div>
</section>
```

Repeated row groups may use `data-dsh-ui-repair-row-group`, with optional
`data-dsh-ui-repair-row` and `data-dsh-ui-repair-icon` markers when their
native semantics are not `button`, `a`, `li`, `svg`, or `img`.

Potentially ambiguous layout ownership remains diagnosis-only unless the
surface opts in. `data-dsh-ui-repair-scroll-x` marks a safe horizontal scroll
owner, `data-dsh-ui-repair-no-shrink` marks a flex item that must preserve its
intrinsic width, and `data-dsh-ui-repair-min-width-zero` marks a flex/grid item
that may shrink below its content width.

## Browser API

The browser module provides `ctx.uiRepair` for cooperating client plugins:

```ts
const report = await ctx.uiRepair.scan()
ctx.uiRepair.setMode('suggest')
await ctx.uiRepair.apply(report.issues[0].id)
ctx.uiRepair.getHistory()
ctx.uiRepair.rollbackAll()
```

All repairs are temporary in this proof of concept. Unloading the plugin calls
`rollbackAll()` and removes its observer, generated styles, and marker
attributes.

## Settings

The standard Plugins → Plugin Configuration card exposes activation, mode,
normal and risky confidence thresholds, startup scanning, mutation scanning,
manual scan/apply/ignore/rollback actions, session health counters, and
persistent ignored selectors. Risky overflow/clipping repairs can never be
configured below 98% confidence.

## Development

```bash
pnpm --filter @yadsh/dsh-ui-repair check
```

The current tests cover detection without mutation, scoped vertical and
horizontal overflow repair, sticky-content safety refusal, icon alignment and
size outliers, flex constraints, manual suggestions, verification, rollback,
client lifecycle, and browser bundle identity.

## Not implemented yet

The specification's persistent repair recipes, plugin-version revalidation,
ResizeObserver integration, full per-plugin health view, screenshot
verification, vision-toolkit integration, and the remaining P0/P1/P2 rules are
intentionally deferred. The proof of concept establishes the lifecycle,
measurement, configuration, scoping, and rollback seams they will use.

## License

[MIT](../../LICENSE). This is an independent community project and is not
affiliated with or endorsed by DeepSeek.
