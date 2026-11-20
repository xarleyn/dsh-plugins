# dsh-ui-repair

![Status: proof of concept](https://img.shields.io/badge/status-proof%20of%20concept-yellow.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

An early, conservative compatibility layer for visual problems in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin
interfaces. It measures rendered DOM, reports narrowly defined layout
anomalies, and can apply reversible scoped CSS without editing another
plugin's source or package files.

[Full specification](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-ui-repair/SPEC.md) ·
[DSH integration investigation](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-ui-repair/docs/INVESTIGATE.md)

## Installation

Install the published npm package by name:

```bash
dsh plugin --profile web add @yadsh/dsh-ui-repair
```

To remove the plugin:

```bash
dsh plugin --profile web remove @yadsh/dsh-ui-repair
```

Restart the DeepSeek Harness host if bundle hot reload does not pick up the newly installed plugin or browser client.

## Current proof of concept

This first implementation slice includes:

- an installable Host package and classic DSH browser bundle;
- semantic repair roots instead of coupling to hashed CSS-module classes;
- `R001` repeated-row icon alignment diagnostics;
- `R002` repeated-row icon size consistency diagnostics;
- `R003`/`R004` repeated-row horizontal and vertical diagnostics;
- `R005`/`R006` unexpected horizontal and vertical overflow diagnostics;
- `R007` clipped-content diagnostics;
- `R008` flex-shrink and `R009` missing-min-width diagnostics;
- `R010` icon-to-label gap and `R011` repeated-row padding diagnostics;
- `R012` clipped text and `R013` outside-parent diagnostics;
- `observe`, `suggest`, and conservative `auto` runtime modes;
- persistent Host settings and a configuration card on the Plugins page;
- persistent selector/plugin/rule ignore policies;
- allowlisted CSS writes scoped by per-repair data attributes;
- animation-frame layout stabilization, verification, and rollback;
- in-memory repair history;
- bounded initial scans and mutation/resize-triggered targeted rescans;
- automatic restoration of every owned DOM attribute and style tag on unload.

The default mode is `observe`. Configuration is persisted by the Host under the
`dsh-ui-repair` namespace, which is the profile entry id the browser card reads
through `ctx.configForms`. Generic overflow is reported but not mutated.
An overflow target must opt in with `data-dsh-ui-repair-scroll` before the
current auto mode can treat it as a safe scroll owner.

## Repair roots

The scanner recognizes these stable boundaries:

```text
[data-dsh-ui-repair-root]
[data-dsh-plugin-root]
[data-plugin-root]
li.dsh-plugin-card
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
`data-dsh-ui-repair-row-height` explicitly permits normalizing an anomalous
row height; without it, R004 remains diagnosis-only.

Potentially ambiguous layout ownership remains diagnosis-only unless the
surface opts in. `data-dsh-ui-repair-scroll-x` marks a safe horizontal scroll
owner, `data-dsh-ui-repair-no-shrink` marks a flex item that must preserve its
intrinsic width, and `data-dsh-ui-repair-min-width-zero` marks a flex/grid item
that may shrink below its content width.

Spacing repairs require `data-dsh-ui-repair-gap` or
`data-dsh-ui-repair-padding` on the anomalous row. Text wrapping requires
`data-dsh-ui-repair-text-wrap`; containment repairs require
`data-dsh-ui-repair-contain`. Without these ownership markers, R010-R013 are
reported but remain diagnosis-only.

## Browser API

The browser module provides `ctx.uiRepair` for cooperating client plugins:

```ts
const report = await ctx.uiRepair.scan()
ctx.uiRepair.setMode('suggest')
await ctx.uiRepair.apply(report.issues[0].id)
ctx.uiRepair.getHistory()
ctx.uiRepair.rollbackAll()
```

Temporary applications are scoped to the page. Unloading removes the engine's
styles and marker tokens. `rollbackAll()` also pauses saved repairs for that
browser session.

## Saved repairs

In **Suggest** mode, apply a repair and then choose **Save verified repair**.
The Host operator's profile settings own the recipe. The package files and
the browser's local storage are separate. A saved repair can run again after
a page or Host restart in Suggest or Auto mode.

The target plugin opts in by marking a stable area with
`data-plugin-package` (full npm name), `data-dsh-ui-repair-root` (stable area
key), and `data-dsh-ui-repair-version` (the version rendering that area).
The element has `data-dsh-ui-repair-anchor` (stable key within the area) and
the relevant existing rule-specific opt-in marker. The Host inventory must
confirm the version. The area and anchor must each resolve uniquely, and the
element must still belong to the area and match its original HTML tag.

Recipe format v1 records the verified scanner rule, original package
version, last checked version and time, and the area and target keys. Layout
rules for opted-in scrolling, flex sizing, and text wrapping are supported.
The current scanner must independently find the issue and supply the repair.
The engine then checks the result and rolls back its own style and tokens
if verification fails.

After a package update, the older recipe stays inactive. **Revalidate** runs
the scoped checks against the new version before approving it in the profile.
Missing, ambiguous or incompatible targets remain inactive with a diagnostic.
A rendered version different from the inventory requires a page reload.
**Remove saved repair** deletes the profile entry and rolls back its active
application. Observe mode pauses saved repairs.

## Settings

The card opens from this bundle's row on the Host's Plugins page and exposes
activation, mode, normal and risky confidence thresholds, startup, mutation, and
resize scanning, manual scan/apply/ignore/rollback actions, session health
counters, and persistent ignored selectors. Risky overflow/clipping repairs can
never be configured below 98% confidence. The row answers every state of its
namespace: while the Host has no settings for this session the card says so and
keeps the scan panel and the rollback action, rather than leaving the section
blank or drawing its defaults as the saved policy — the Plugins page stays
reachable from a browser the settings directory is intentionally closed to.

## Development

```bash
pnpm --filter @yadsh/dsh-ui-repair check
```

The current tests cover detection without mutation, scoped vertical and
horizontal overflow repair, sticky-content safety refusal, icon and row
alignment/size outliers, flex constraints, plugin attribution, ResizeObserver,
gap/padding consistency, text overflow, parent containment, manual suggestions,
verification, rollback, client lifecycle, and browser bundle identity.

## Not implemented yet

The full per-plugin health view, screenshot verification, vision-toolkit
integration, and the remaining P0/P1/P2 rules are intentionally deferred. The
proof of concept establishes the lifecycle, measurement, configuration,
scoping, and rollback seams they will use.

## License

[MIT](https://github.com/xarleyn/dsh-plugins/blob/main/LICENSE). This is an independent community project and is not
affiliated with or endorsed by DeepSeek.
