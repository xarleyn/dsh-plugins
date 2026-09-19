/**
 * Identity shared by the Host plugin and its browser card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/**
 * Settings namespace the plugin owns and its card binds to. It equals the
 * Cordis plugin id (`name` in `src/index.ts`): the host registers the plugin's
 * `static Config` schema under that name.
 */
export const OPENVIKING_MEMORY_SETTINGS_NAMESPACE = "dsh-openviking-memory";
