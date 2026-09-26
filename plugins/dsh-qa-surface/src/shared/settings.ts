/**
 * Identity shared by the Host plugin and its browser settings card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/**
 * Settings namespace the QA surface owns and its card binds to.
 *
 * The namespace is the profile entry id the bundle declares in
 * `cordis.patch.yml`, not a name this plugin picks: the Host derives the
 * configuration form of every entry from its volatile `Config` fields and serves
 * it under that id.
 */
export const QA_SURFACE_SETTINGS_NAMESPACE = "dsh-qa-surface";
