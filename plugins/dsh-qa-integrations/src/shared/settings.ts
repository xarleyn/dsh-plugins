/**
 * Identity shared by the Host plugin and its operator card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/**
 * Settings namespace the plugin owns and its operator card binds to. The
 * namespace carries the deployment configuration the card edits; the profile
 * composition row stays the base layer an override reverts to.
 */
export const QA_INTEGRATIONS_SETTINGS_NAMESPACE = "qa-integrations";
