/**
 * The one place that names the settings namespace. The Host serves the section
 * and the browser card keys on it, so both halves must agree without importing
 * each other (the host entry pulls Node code into the bundle, the card pulls
 * DOM code into the Host).
 * @module shared/settings
 */

/**
 * Settings namespace of the Integrations card.
 *
 * The Plugins tab dispatches a card by the namespace its Host serves, so the
 * deployment mounts this section to give the browser half a key. It carries no
 * editable value on purpose: the provider switches, the address policy and the
 * vault path are composition-time decisions (`cordis.patch.yml`) that the
 * runtime resolves once at boot, and a settings field the runtime only honored
 * after a restart would read as a save that applied.
 */
export const QA_INTEGRATIONS_SETTINGS_NAMESPACE = "qa-integrations";
