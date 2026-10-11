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

/**
 * The key of the seat this card takes on the Host's Plugins page.
 *
 * `plugins.row.config` is keyed `<package name>#<row id>`, so the two names the
 * page joins are this bundle's `package.json.name` and the profile entry id
 * above. Neither is a name this plugin picks: a key that drifts from that pair
 * leaves the row without its configure control and the card off the page, with
 * nothing said about it.
 */
export const QA_SURFACE_ROW_CONFIG_KEY = `@yadsh/dsh-qa-surface#${QA_SURFACE_SETTINGS_NAMESPACE}`;
