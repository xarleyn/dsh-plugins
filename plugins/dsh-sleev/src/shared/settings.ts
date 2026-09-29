/**
 * Profile entry id that owns the live settings namespace, shared by the Host
 * presentation policy and the browser card. Since `0.1.7` the namespace is the
 * Cordis profile entry id, not a name the plugin chooses.
 */
export const SLEEV_SETTINGS_NAMESPACE_ID = "dsh-sleev";

/**
 * Seat key of the card on the Host Plugins page: the bundle's package name and
 * the row id its `cordis.patch.yml` declares, joined by `#`. The row id is the
 * profile entry id above, which is why moving the card keeps the namespace.
 */
export const SLEEV_ROW_CONFIG_KEY = `@yadsh/dsh-sleev#${SLEEV_SETTINGS_NAMESPACE_ID}`;
