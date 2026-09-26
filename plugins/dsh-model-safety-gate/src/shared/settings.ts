/**
 * Identity shared by the Host plugin and its browser card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/**
 * Settings namespace the gate owns and its card binds to.
 *
 * Since `0.1.7` the namespace of a configuration form is the profile entry id
 * of the plugin that owns it, so this literal must stay equal to the row id in
 * `cordis.patch.yml`; the package verification asserts the pair.
 */
export const SAFETY_GATE_SETTINGS_NAMESPACE = "dsh-model-safety-gate";
