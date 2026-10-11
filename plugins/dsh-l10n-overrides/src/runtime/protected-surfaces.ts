// Protected-surface tables for the DOM translator (SPEC §12-§14): the
// selectors and attribute heuristics that keep harness-owned UI (conversations,
// editors, terminals, code) out of translation.
export const KNOWN_PROTECTION_ATTRIBUTES = new Set([
  "class",
  "contenteditable",
  "data-no-translate",
  "data-message-id",
  "data-testid",
]);
// A name that reads like one of these surface kinds marks the node as owned by
// the harness. `composer` counts only as a test id: the composer's class is
// layout, while its test id names the buffer of what the operator has typed.
const CLASS_PROTECTION_KEYWORDS = [
  "conversation",
  "message",
  "markdown",
  "editor",
  "terminal",
  "prompt",
];
const TEST_ID_PROTECTION_KEYWORDS = [...CLASS_PROTECTION_KEYWORDS, "composer"];
// The surfaces that carry someone else's text — a rendered answer, a quoted
// file, a line of the log buffer — which epic #453 named with a stable
// `data-testid` no keyword above reads. A prefix protects the whole zone the id
// family paints. These ids, not a class name, are the handle the translator
// trusts; the class keywords stay as the fallback for markup that carries no
// test id yet.
const PROTECTED_SURFACE_TEST_IDS = [
  // Written by plugins/dsh-plugin-log-ui/src/client/panel/LogPanel.tsx and
  // pinned by that package's scripts/verify-package.mjs, so the producer cannot
  // rename it out of this table unnoticed. The fixture below only imitates it.
  "log-panel-line",
  "qa-source-chip-card-snippet",
  "qa-source-detail-snippet",
];
const PROTECTED_SURFACE_TEST_ID_PREFIXES = ["qa-md-"];
const escapeForPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
export const CLASS_PROTECTION_PATTERN = new RegExp(
  CLASS_PROTECTION_KEYWORDS.join("|"),
  "i",
);
export const TEST_ID_PROTECTION_PATTERN = new RegExp(
  [
    ...TEST_ID_PROTECTION_KEYWORDS,
    ...PROTECTED_SURFACE_TEST_IDS.map((id) => `^${escapeForPattern(id)}$`),
    ...PROTECTED_SURFACE_TEST_ID_PREFIXES.map(
      (prefix) => `^${escapeForPattern(prefix)}`,
    ),
  ].join("|"),
  "i",
);
export const SCOPE_AND_PROTECTION_ATTRIBUTES = [
  "class",
  "id",
  ...KNOWN_PROTECTION_ATTRIBUTES,
];
export const SHARED_PROTECTED_SURFACES = [
  "[contenteditable]",
  "[data-no-translate]",
  "[data-message-id]",
  ...TEST_ID_PROTECTION_KEYWORDS.map(
    (keyword) => `[data-testid*="${keyword}" i]`,
  ),
  ...PROTECTED_SURFACE_TEST_IDS.map((id) => `[data-testid="${id}"]`),
  ...PROTECTED_SURFACE_TEST_ID_PREFIXES.map(
    (prefix) => `[data-testid^="${prefix}" i]`,
  ),
  ...CLASS_PROTECTION_KEYWORDS.map((keyword) => `[class*="${keyword}" i]`),
];
export const CODE_LIKE_PROTECTED_SURFACES = [
  "pre",
  "code",
  "kbd",
  "samp",
  "script",
  "style",
];
export const TEXT_PROTECTED_SURFACE_SELECTOR = [
  "input",
  "textarea",
  ...CODE_LIKE_PROTECTED_SURFACES,
  ...SHARED_PROTECTED_SURFACES,
].join(",");
export const ATTRIBUTE_PROTECTED_SURFACE_SELECTOR = [
  ...CODE_LIKE_PROTECTED_SURFACES,
  ...SHARED_PROTECTED_SURFACES,
].join(",");
