# DSH Web integration investigation

Verified on 2026-09-09 against the local DeepSeek Harness source tree at
`D:/repos/dsh/deepseek-harness-source` and the monorepo's pinned development
release, `0.1.1-rc.2`.

## Client lifecycle

- A package with `dsh.client.platform = "web"` ships a classic browser bundle.
- The bundle must call `window.__ModuleLoader__.load()` with the complete npm
  package name, `@yadsh/dsh-ui-repair`.
- A browser plugin's `apply(ctx)` may return a disposer. Cordis also exposes
  owned services through `ctx.provide(name, value)`, whose returned disposer
  removes the service on unload.
- The proof of concept therefore provides `ctx.uiRepair`, starts browser-only
  observation, and tears down the observer plus every applied repair from one
  idempotent disposer.

Relevant upstream seams:

- `packages/extensions/cordis-client-runner/src/client/`
- `packages/client/web/src/`
- `node_modules/@deepseek-ai/cordis/src/reflect.ts`

## Settings DOM and extension points

The current settings shell is implemented by
`packages/client/ui-settings-general/src/client/SettingsRoot.tsx`. Its CSS
classes come from CSS modules and are not a stable targeting contract.
Semantic DOM is available instead:

- the modal is `role="dialog" aria-modal="true"`;
- plugin configuration cards arrive through the keyed
  `settings.plugin.item` slot;
- the slot system emits `data-slot` wrappers;
- plugin cards are direct `<li>` children of the host `<ul>`.

The current upstream Settings implementation already gives its options area
the correct scroll-owner contract:

```css
flex: 1;
min-height: 0;
overflow-y: auto;
```

That means the historical `.settings-panel` hypothesis in the specification
must not be hard-coded. This plugin observes the dialog boundary and only
auto-repairs generic overflow after an owner explicitly opts in through
`data-dsh-ui-repair-scroll`.

Relevant upstream seams:

- `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`
- `packages/client/ui-settings-plugins/src/client/ConfigurablePluginsTab.tsx`
- `packages/client/ui-settings-plugins/src/client/slot-contract.ts`

## Plugin attribution

There is no public browser API that maps every arbitrary DOM node back to its
Cordis package. The safe evidence available today is an enclosing stable
boundary carrying `data-dsh-plugin-root`, `data-plugin-root`, `data-plugin`, or
the keyed slot wrapper. The scanner reports `plugin` only when explicit data
exists; it does not infer ownership from one CSS class name.

## Observers and work bounds

`MutationObserver` and `ResizeObserver` are available in supported browsers
and already used in upstream DSH clients. The initial implementation uses one
mutation observer with a bounded attribute filter and queues only affected
roots on the next animation frame. Each root scan stops after a configurable
element cap (300 by default). Resize-driven rescans remain a follow-up because
they need a root subscription ledger to avoid broad observation.

## Non-public assumptions

None are used for behavior. The proof of concept does not import DSH host
internals into the browser bundle, read CSS-module class names, patch upstream
packages, or depend on the layout implementation's private React structure.
