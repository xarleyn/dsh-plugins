/**
 * Identity shared by the Host plugin and its browser card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name. The wire types the account-scoped
 * page exchanges live next door in `../types.ts`, which this module does not
 * import.
 */

/**
 * Settings namespace the plugin owns and its card binds to. It equals the
 * Cordis plugin id (`name` in `src/index.ts`), and on 0.1.7 that identity is
 * the whole contract: the Host serves a settings namespace for every profile
 * entry whose `static Config` carries a volatile knob, and a card reaches that
 * namespace through `ctx.configForms.get(namespace)`. No registration call
 * publishes it — declaring the knobs is the registration.
 */
export const OPENVIKING_MEMORY_SETTINGS_NAMESPACE = "dsh-openviking-memory";

/** The Remote namespace the account-scoped settings page talks to. */
export const OPENVIKING_MEMORY_REMOTE_NAMESPACE = "openvikingMemory";
