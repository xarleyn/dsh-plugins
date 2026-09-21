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
 * Cordis plugin id (`name` in `src/index.ts`).
 *
 * `static Config` alone does not publish it: the Host's settings directory
 * lists only the namespaces a live plugin registered through the settings
 * service, and a card is rendered for a namespace in that directory. The
 * registration is `installOpenVikingMemorySettings` in `src/settings.ts`.
 */
export const OPENVIKING_MEMORY_SETTINGS_NAMESPACE = "dsh-openviking-memory";

/** The Remote namespace the account-scoped settings page talks to. */
export const OPENVIKING_MEMORY_REMOTE_NAMESPACE = "openvikingMemory";
