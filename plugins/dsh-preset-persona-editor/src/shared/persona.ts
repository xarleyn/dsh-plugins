/**
 * Names the persona row and its prompt sections carry.
 *
 * Node-free on purpose: the browser half imports these too, and anything with
 * a builtin behind it would break the bundle rather than a test.
 * @module shared/persona
 */

/** Module specifier the persona row of a preset composition names. */
export const PERSONA_PLUGIN_NAME = "@deepseek-ai/dsh-persona";

/** Row id the shipped compositions give the persona row. */
export const PERSONA_ROW_ID = "persona";

/**
 * Config keys this editor owns. A persona row may carry other keys (an older
 * composition, a hand-written one); those are preserved untouched and reported
 * rather than silently rewritten.
 */
export const PERSONA_MANAGED_KEYS = [
  "prefix",
  "suffix",
  "complete",
  "includeRuntimeContext",
] as const;

/** One managed config key. */
export type PersonaManagedKey = (typeof PERSONA_MANAGED_KEYS)[number];

/**
 * Section placement name the persona prefix registers under, resolved through
 * the host's own order table instead of a copied number.
 */
export const PERSONA_PREFIX_ORDER_NAME = "DEPLOYMENT_PERSONA_PREFIX";

/** Section placement name the persona suffix registers under. */
export const PERSONA_SUFFIX_ORDER_NAME = "DEPLOYMENT_PERSONA_SUFFIX";

/**
 * Order numbers the placement names resolve to when the deployment exposes no
 * `systemPrompt` service to ask. These are the harness's published vocabulary
 * (`dsh-system-prompt` `SECTION_ORDERS`), used only for the preview outline.
 */
export const PERSONA_PREFIX_FALLBACK_ORDER = 0;
export const PERSONA_SUFFIX_FALLBACK_ORDER = 10200;
