/**
 * The settings namespace, shared by the Host section install and the browser
 * card so the two can never drift apart. This module must stay dependency
 * free: the card bundle inlines it, and pulling the config schema (and with it
 * Schemastery) into the page would bloat the bundle for one string.
 */

/** Settings namespace owning this plugin's user-editable section. */
export const JEV_COMPACTION_SETTINGS_NAMESPACE = "jev-compaction";
