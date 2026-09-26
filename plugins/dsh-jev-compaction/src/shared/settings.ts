/**
 * The settings namespace, shared by the Host plugin and the browser card so the
 * two can never drift apart. This module must stay dependency free: the card
 * bundle inlines it, and pulling the config schema (and with it Schemastery)
 * into the page would bloat the bundle for one string.
 *
 * On 0.1.7 the namespace is not a name the plugin invents: a plugin's
 * configuration *is* the settings document section keyed by its profile entry
 * id, which `cordis.patch.yml` declares as `dsh-jev-compaction`. Renaming it
 * here would address a section the Host never serves.
 */

/** Profile entry id whose volatile configuration the card edits. */
export const JEV_COMPACTION_SETTINGS_NAMESPACE = "dsh-jev-compaction";
