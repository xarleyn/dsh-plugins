/**
 * Identity shared by the Host plugin and its browser settings card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/** Settings namespace the QA surface owns and its card binds to. */
export const QA_SURFACE_SETTINGS_NAMESPACE = "qa-surface";
