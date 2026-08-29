# dsh-l10n-overrides Design

## Scope

`dsh-l10n-overrides` is a browser-only DeepSeek Harness plugin that overlays English translations onto third-party DSH plugins without modifying their packages or registering competing locale dictionaries. Version 0.1 includes locale lookup overrides, exact scoped DOM translations, reversible locale switching, diagnostics, one example pack, tests, packaging checks, and authoring documentation.

There is no Host service, RPC boundary, settings UI, runtime translation service, external pack loading, or target-plugin source dependency in this release.

## Public contract

Each built-in translation pack declares a stable id, target package metadata, English namespace/key translations, optional exact DOM rules, and optional descriptive metadata. The v0.1 authoring API deliberately exposes only `en`; internal registry keys include the locale so additional languages can be added later without changing runtime boundaries.

Target version ranges are informational. An unavailable or incompatible target version never disables a pack because DSH currently exposes no reliable public installed-plugin version API.

## Components

### Translation registry

`TranslationPackRegistry` normalizes built-in packs into indexed locale lookups and indexed DOM rules. The first registered value remains active when two packs claim the same locale/namespace/key. Every collision is recorded as a diagnostic error with both pack ids, so import order is deterministic behavior rather than an undocumented priority mechanism.

The registry also warns about `scope: "global"`, counts packs, locale overrides, and DOM rules, and exposes immutable diagnostic snapshots.

### Locale runtime adapter and hook

All unsafe knowledge of DSH's runtime-private `translate` method lives in one adapter. It feature-detects `getSnapshot`, `subscribe`, and `translate`; an incompatible shape returns a diagnostic and leaves DSH untouched.

The hook stores the original method and installs one wrapper. For active locale `en`, the wrapper checks the registry first and interpolates a matching value. Missing keys and all non-English locales call the original method with the runtime as `this`. Existing functions returned by `locale.bind(namespace)` continue to work because current DSH bindings resolve `this.translate` at call time.

Disposal restores the original method only when the current method is still this plugin's wrapper. Repeated installation on the same runtime is rejected without stacking wrappers.

### DOM translator

The DOM fallback groups exact rules by scope and source text. It scans relevant scopes once at activation. Mutation batches inspect only changed nodes and their descendants; they never trigger a document-wide rescan.

Text translation uses exact trimmed comparison while preserving surrounding whitespace. Attribute translation is restricted to `placeholder`, `title`, `aria-label`, and `alt`. Rules cannot alter `value`, links, sources, identifiers, classes, or data attributes.

A centralized denylist excludes inputs, textareas, code/preformatted content, scripts, styles, editable regions, explicit no-translate regions, and known DSH conversation, Markdown, editor, prompt, and terminal surfaces. A node is eligible only when it belongs to the rule's scope and no excluded ancestor lies between it and that scope. Global rules are allowed only by explicit declaration and produce a warning.

Original text and attribute values are retained in weak maps. Switching away from English restores translated values, switching back rescans declared scopes, and plugin disposal restores the DOM before releasing references. Restoration only changes values that still equal the plugin's translated value, preserving later changes made by another owner.

### Composition root and diagnostics

The client entrypoint constructs a single diagnostics reporter and registry, registers the centralized pack list, activates the locale hook, then activates DOM translation when browser APIs exist. Startup failures are caught per capability and reported; they never fail plugin activation or target plugins.

Diagnostics use the `[dsh-l10n-overrides]` prefix. Summary and compatibility messages are emitted once. Per-lookup messages are available only when debug mode is enabled.

## Lifecycle and data flow

On activation, packs are registered before runtime hooks. The locale wrapper immediately affects locale API calls. If the active locale is English, the DOM translator performs its initial scoped scan. The public `locale/change` event updates DOM state: English activates and scans; another locale disconnects translation behavior and restores previous changes while the observer remains available for the next English activation.

On disposal, the observer disconnects, locale listeners unsubscribe, DOM values are restored, and the locale method is conditionally restored. All disposer paths are idempotent.

## Failure model

- Missing or changed LocaleRuntime methods disable locale overrides and produce one error.
- Missing browser DOM APIs disable only DOM overrides.
- Invalid CSS scopes and individual DOM rules are diagnosed and skipped without aborting other packs.
- Duplicate locale overrides preserve the first registered translation and record an error.
- Observer or rule failures are isolated to the affected mutation/rule and do not escape into DSH.
- Unknown interpolation parameters remain as placeholders; `null` and `undefined` values do not throw.

## Project layout

The package follows current DSH client-plugin conventions while keeping domain units focused:

```text
src/
├── client/index.ts
├── adapters/dsh-locale-runtime.ts
├── registry/diagnostics.ts
├── registry/translation-registry.ts
├── runtime/dom-translator.ts
├── runtime/interpolate.ts
├── runtime/locale-hook.ts
├── packs/example.ts
├── packs/index.ts
└── types.ts
```

The package exports the client plugin and pack authoring types, but does not expose unsafe DSH adapter types as a supported API.

## Testing and packaging

Vitest covers interpolation, registry lookup/collisions, feature detection, `this` preservation, pre-bound translators, idempotent disposal, scoped DOM translation, dynamic mutations, attributes, denylisted surfaces, locale restoration, and failure-open behavior. DOM tests use jsdom.

The build emits the DSH module-loader client bundle and declarations. Package verification inspects the packed artifact, confirms only intended files are published, checks the browser bundle wrapper and forbidden dependencies, and runs a smoke import. `pnpm check` runs formatting, strict typecheck, tests, build, and package verification.

## Compatibility principle

The only intentional non-public integration is assignment to the runtime `translate` method. It is isolated, reversible, feature-detected, and tested against `@deepseek-ai/dsh-client-locale@0.1.1-rc.2`. Translation packs depend only on observed namespaces, keys, selectors, and visible source strings.

> Translate plugins from the outside; never own or modify their source.
