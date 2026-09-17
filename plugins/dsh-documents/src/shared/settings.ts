/**
 * The one place that names the settings namespace. The Host installs the
 * section under it and the browser card keys on it, so both halves must agree
 * without importing each other (the host entry pulls Node code into the bundle,
 * the card pulls DOM code into the Host).
 * @module shared/settings
 */

/** Settings namespace of the document pipeline. */
export const DOCUMENTS_SETTINGS_NAMESPACE = "documents";

/**
 * Tool names the registered surface advertises, for the card's inventory. The
 * pipeline keeps its own copy next to the definitions; a test pins the two
 * together, because a drift here would misdescribe the plugin in the UI.
 */
export const DOCUMENT_TOOL_NAMES: readonly string[] = [
  "document_create",
  "document_to_markdown",
  "document_from_url",
  "document_convert",
  "document_inspect",
];

/**
 * Tools that only exist while `comparison.enabled` is on. Kept apart from the
 * five above, because the inventory the card shows must say which tools can be
 * absent from a deployment.
 */
export const DOCUMENT_COMPARISON_TOOL_NAMES: readonly string[] = [
  "document_compare",
  "document_diff_read",
];
