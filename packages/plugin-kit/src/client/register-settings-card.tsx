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
   * The keyed seat's `key`. On {@link PLUGIN_ROW_CONFIG_SLOT} that is
   * `<package name>#<row id>`, the row id being the `id` the bundle's
   * `cordis.patch.yml` declares — which is also the settings namespace the Host
   * resolves the volatile Config under. {@link registerSettingsCard} and
   * {@link registerSettingsSlot} refuse anything else on that seat, because a
   * bare namespace there registers under a row that does not exist.
   */
  readonly key: string;
  /** Card component mounted into the slot. */
  readonly component: unknown;
  /** Dictionary namespace forwarded to the slot registration. */
  readonly locale?: string;
  /** Business face factory forwarded to the slot registration. */
  readonly inject?: () => unknown;
  /**
   * CSS to inject: the canonical shell plus the plugin's body rules on a seat
   * that frames itself, and the body rules alone on
   * {@link PLUGIN_ROW_CONFIG_SLOT}, whose row draws the frame, the heading and
   * the expand control. Omit when the plugin already manages its stylesheet
   * (e.g. through `ctx.effect`). A shell reaching the row seat is refused
   * rather than drawn as a second card inside the Host's.
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

/*
 * The shell classes the row seat must not carry, counted where CSS reads them as
 * used: a selector position, not the bare word. A stylesheet that only documents
 * the removed frame in a comment stays legal — the same distinction the package
 * contract makes, so the kit and the gate refuse the same string.
 */
const SHELL_SELECTOR = /\.dsh-plugin-card[\w-]*(?=\s*[,{])/u;

function noop(): void {}

/**
 * Refuse a row registration that cannot draw. A missing seat used to be the
 * silent failure of this helper; a row card keyed by a bare namespace or carrying
 * its own frame is the same failure moved one field over, so the seat is checked
 * where the seat is chosen, at the call, rather than at release.
 */
function assertRowSeat(slotName: string, options: SettingsCardOptions): void {
  if (slotName !== PLUGIN_ROW_CONFIG_SLOT) return;
  const [packageName, rowId, ...rest] = options.key.split("#");
  if (!packageName || !rowId || rest.length > 0) {
    throw new Error(
      `the "${PLUGIN_ROW_CONFIG_SLOT}" seat is keyed "<package name>#<row id>", ` +
        `got "${options.key}" — the row id is the id the bundle's cordis.patch.yml ` +
        `declares. A bare namespace registers under a row that does not exist, and ` +
        `the card is drawn nowhere.`,
    );
  }
  if (options.styles !== undefined && SHELL_SELECTOR.test(options.styles)) {
    throw new Error(
      `a card seated on "${PLUGIN_ROW_CONFIG_SLOT}" passed the canonical shell in ` +
        `its styles — the panel row draws the frame, the heading and the expand ` +
        `control, so our shell there is a second card inside the Host's. Pass the ` +
        `plugin's own body rules only.`,
    );
  }
}

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
 *
 * Throws when the seat is the panel row and the registration cannot draw there:
 * a key that is not the composite `<package name>#<row id>`, or a stylesheet
 * carrying our shell next to the frame the Host already draws.
 */
export function registerSettingsSlot(
  host: SettingsCardHost,
  options: SettingsCardOptions,
): () => void {
  const slotName = options.slotName ?? PLUGIN_ROW_CONFIG_SLOT;
  assertRowSeat(slotName, options);
  const slotOptions: SettingsCardSlotOptions = {
    name: slotName,
    key: options.key,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.inject === undefined ? {} : { inject: options.inject }),
  };
  return host.slots.register(slotOptions, options.component);
}

/**
 * Full bootstrap: check the seat, inject {@link options.styles} once (when
 * provided), then mount the card into the seat named by {@link options.slotName},
 * defaulting to the Plugins panel row seat. Returns a disposer removing the slot
 * effect and the injected stylesheet.
 *
 * The check runs before anything reaches the Host, so a row registration that
 * cannot draw fails at the call rather than inside the Host's render, where a
 * swallowed throw would leave the card missing and the reason unsaid.
 */
export function registerSettingsCard(
  host: SettingsCardHost,
  options: SettingsCardOptions,
): () => void {
  const slotName = options.slotName ?? PLUGIN_ROW_CONFIG_SLOT;
  assertRowSeat(slotName, options);
  const removeStyles =
    options.styles === undefined || options.pluginName === undefined
      ? undefined
      : injectCardStyles(options.pluginName, options.styles);
  const disposeEffect = host.slots.inject(slotName, () =>
    registerSettingsSlot(host, options),
  );
  return () => {
    disposeEffect();
    removeStyles?.();
  };
}
