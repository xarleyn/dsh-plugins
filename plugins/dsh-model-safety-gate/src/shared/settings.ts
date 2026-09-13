/**
 * Identity shared by the Host plugin and its browser card.
 *
 * This module must stay dependency-free: the card bundle inlines it, and a
 * browser build must not pull the Host config surface (schemastery) into the
 * page just to learn the namespace name.
 */

/** Settings namespace the gate owns and its card binds to. */
export const SAFETY_GATE_SETTINGS_NAMESPACE = "model-safety-gate";
