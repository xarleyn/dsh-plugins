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
export const CLASS_PROTECTION_PATTERN =
  /conversation|message|markdown|editor|terminal|prompt/i;
export const TEST_ID_PROTECTION_PATTERN =
  /conversation|message|markdown|editor|terminal|prompt|composer/i;
export const SCOPE_AND_PROTECTION_ATTRIBUTES = [
  "class",
  "id",
  ...KNOWN_PROTECTION_ATTRIBUTES,
];
export const SHARED_PROTECTED_SURFACES = [
  "[contenteditable]",
  "[data-no-translate]",
  "[data-message-id]",
  '[data-testid*="conversation" i]',
  '[data-testid*="message" i]',
  '[data-testid*="markdown" i]',
  '[data-testid*="editor" i]',
  '[data-testid*="terminal" i]',
  '[data-testid*="prompt" i]',
  '[data-testid*="composer" i]',
  '[class*="conversation" i]',
  '[class*="message" i]',
  '[class*="markdown" i]',
  '[class*="editor" i]',
  '[class*="terminal" i]',
  '[class*="prompt" i]',
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
