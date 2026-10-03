/**
 * Shared `apply()` bootstrap for plugin settings cards: injects the card CSS
 * once and mounts the card into the keyed `plugins.row.config` seat of the
 * Host's own row on the Plugins panel. The ModuleLoader registration itself
 * (`window.__ModuleLoader__.load({ id, factory })` with the full package name as
 * `id`) is produced by each plugin's client tsdown banner.
 *
 * The host surface is structural on purpose: the four client variants reach
 * the slot registry through different context types (sync `ctx.get`, async
 * `ctx.inject` sub-contexts, `ClientContext` effects), and all of them expose
 * the same `slots.inject` / `slots.register` pair.
 */

/** Loose structural view of the registration options the kit builds. */
export interface SettingsCardSlotOptions {
  readonly name: string;
  readonly key?: string;
  readonly locale?: string;
  readonly inject?: unknown;
}

/** Structural face of the host's slot registry used by the kit. */
export interface SettingsCardSlots {
  inject(slotName: string, factory: () => unknown): () => void;
  register(options: SettingsCardSlotOptions, component: unknown): () => void;
}

/** Structural face of the host context the kit needs. */
export interface SettingsCardHost {
  readonly slots: SettingsCardSlots;
}

/** Options for {@link registerSettingsSlot} / {@link registerSettingsCard}. */
export interface SettingsCardOptions {
  /**
   * The keyed seat's `key`. On the default seat that is
   * `<package name>#<row id>`, the row id being the `id` the bundle's
   * `cordis.patch.yml` declares — which is also the settings namespace the Host
   * resolves the volatile Config under.
   */
  readonly key: string;
  /** Card component mounted into the slot. */
  readonly component: unknown;
  /** Dictionary namespace forwarded to the slot registration. */
  readonly locale?: string;
  /** Business face factory forwarded to the slot registration. */
  readonly inject?: () => unknown;
  /**
   * Full CSS to inject (canonical shell + plugin body rules); the canonical
   * shell half must come from {@link PLUGIN_CARD_SHELL_CSS}. Omit when the
   * plugin already manages its stylesheet (e.g. through `ctx.effect`), and omit
   * it outright on the Plugins panel seat, whose row draws the frame itself.
   */
  readonly styles?: string;
  /** Plugin/package name keying the style tag (see {@link injectCardStyles}). */
  readonly pluginName?: string;
  /** Seat to register into; defaults to {@link PLUGIN_ROW_CONFIG_SLOT}. */
  readonly slotName?: string;
}

/**
 * The Plugins panel seat a configuration card registers into: the keyed seat of
 * the bundle's own row, which `0.1.7` made the place for plugin configuration.
 */
export const PLUGIN_ROW_CONFIG_SLOT = "plugins.row.config";

function noop(): void {}

/**
 * Inject one stylesheet tag for the plugin's card CSS. The tag carries
 * `data-plugin="<pluginName>"` and is guarded against double injection; the
 * returned disposer removes the tag when this call created it. No-op in
 * non-DOM environments (headless bundles, module probes).
 */
export function injectCardStyles(pluginName: string, css: string): () => void {
  if (typeof document === "undefined") return noop;
  // Minimal-DOM probes (unit-test stubs) may lack querySelector; treat that as
  // "not injected yet" instead of crashing.
  const selector = `style[data-plugin="${pluginName}"]`;
  const alreadyInjected =
    typeof document.querySelector === "function" &&
    document.querySelector(selector) !== null;
  if (alreadyInjected) return noop;
  const tag = document.createElement("style");
  tag.dataset.plugin = pluginName;
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}

/**
 * Register the card component into the seat named by the options' `slotName`,
 * {@link PLUGIN_ROW_CONFIG_SLOT} when they name none. Returns the registration
 * disposer. Use this variant when the plugin drives the slot's inject-factory
 * itself (e.g. to dispose a form controller alongside).
 */
export function registerSettingsSlot(
  host: SettingsCardHost,
  options: SettingsCardOptions,
): () => void {
  const slotName = options.slotName ?? PLUGIN_ROW_CONFIG_SLOT;
  const slotOptions: SettingsCardSlotOptions = {
    name: slotName,
    key: options.key,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.inject === undefined ? {} : { inject: options.inject }),
  };
  return host.slots.register(slotOptions, options.component);
}

/**
 * Full bootstrap: inject {@link options.styles} once (when provided), then
 * mount the card into the seat named by {@link options.slotName}, defaulting to
 * the Plugins panel row seat. Returns a disposer removing the slot effect and
 * the injected stylesheet.
 */
export function registerSettingsCard(
  host: SettingsCardHost,
  options: SettingsCardOptions,
): () => void {
  const removeStyles =
    options.styles === undefined || options.pluginName === undefined
      ? undefined
      : injectCardStyles(options.pluginName, options.styles);
  const slotName = options.slotName ?? PLUGIN_ROW_CONFIG_SLOT;
  const disposeEffect = host.slots.inject(slotName, () =>
    registerSettingsSlot(host, options),
  );
  return () => {
    disposeEffect();
    removeStyles?.();
  };
}
