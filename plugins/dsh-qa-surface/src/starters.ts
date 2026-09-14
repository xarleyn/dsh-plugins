import type {
  QaAccountStarters,
  QaAccountStartersInput,
  QaAccountStarter,
} from "./types.js";
import { cleanBlock, cleanLine } from "./profile.js";

/**
 * Per-account starter messages: the labeled buttons above an empty composer,
 * and what each of them sends. Shape, limits, and the normalization both
 * halves of the plugin agree on. Deliberately free of Node built-ins — the
 * accounts store and the browser-side form import these same rules, the same
 * way profile.ts does for the self-declared identity.
 */

/** Most starter buttons one account may store. */
export const QA_STARTERS_MAX_ITEMS = 12;
/** Longest accepted button label. */
export const QA_STARTERS_MAX_LABEL = 80;
/** Longest accepted prompt one button sends. */
export const QA_STARTERS_MAX_PROMPT = 2_000;

/** The starters of an account that never customized them. */
export function emptyStarters(): QaAccountStarters {
  return { items: [], hideDefaults: false };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read one stored (or wire-delivered) starters record into its public shape.
 * Unknown or hand-edited input degrades to the readable subset instead of
 * throwing, mirroring the profile read path: a malformed record must never
 * cost the account its session.
 */
export function normalizeStarters(value: unknown): QaAccountStarters {
  const raw = asRecord(value);
  if (raw === undefined) return emptyStarters();
  const items: QaAccountStarter[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (items.length >= QA_STARTERS_MAX_ITEMS) break;
    const item = asRecord(entry);
    if (item === undefined) continue;
    const label = cleanLine(item.label, QA_STARTERS_MAX_LABEL);
    const prompt = cleanBlock(item.prompt, QA_STARTERS_MAX_PROMPT);
    // An incomplete pair is dead weight in the stored record: the editor
    // refuses it on the write path, so the read path simply drops it.
    if (label === "" || prompt === "") continue;
    items.push({ label, prompt });
  }
  return { items, hideDefaults: raw.hideDefaults === true };
}

/** Validated starters values, before the store persists them. */
export type QaStartersWrite = QaAccountStartersInput;

export type QaStartersWriteResult =
  | { readonly ok: true; readonly value: QaStartersWrite }
  | { readonly ok: false; readonly message: string };

/**
 * Validate one full-replace starters write. Values are cleaned the same way
 * the read path cleans them, but limits are refused with a message instead of
 * truncated, so a user pasting an essay learns why it was not stored.
 */
export function validateStartersWrite(input: unknown): QaStartersWriteResult {
  const raw = asRecord(input);
  if (raw === undefined) {
    return { ok: false, message: "the starters payload is not an object" };
  }
  if (raw.hideDefaults !== undefined && typeof raw.hideDefaults !== "boolean") {
    return { ok: false, message: "hideDefaults must be a boolean" };
  }
  const items: QaAccountStarter[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = asRecord(entry);
    if (item === undefined) {
      return { ok: false, message: "each starter must be an object" };
    }
    const label = cleanLine(item.label, Number.MAX_SAFE_INTEGER);
    const prompt = cleanBlock(item.prompt, Number.MAX_SAFE_INTEGER);
    if (label === "") {
      return { ok: false, message: "every starter needs a label" };
    }
    if (prompt === "") {
      return { ok: false, message: "every starter needs a prompt" };
    }
    if (label.length > QA_STARTERS_MAX_LABEL) {
      return {
        ok: false,
        message: `the label must be at most ${QA_STARTERS_MAX_LABEL} characters`,
      };
    }
    if (prompt.length > QA_STARTERS_MAX_PROMPT) {
      return {
        ok: false,
        message: `the prompt must be at most ${QA_STARTERS_MAX_PROMPT} characters`,
      };
    }
    items.push({ label, prompt });
  }
  if (items.length > QA_STARTERS_MAX_ITEMS) {
    return {
      ok: false,
      message: `at most ${QA_STARTERS_MAX_ITEMS} starters can be stored`,
    };
  }
  return {
    ok: true,
    value: { items, hideDefaults: raw.hideDefaults === true },
  };
}

/**
 * The buttons an empty composer shows: the account's own starters first,
 * then the deployment's suggestions unless the account hid them. An anonymous
 * visitor (no starters of their own) sees exactly the deployment's list.
 */
export function effectiveQuickQuestions(
  own: QaAccountStarters | undefined,
  defaults: readonly string[],
): readonly QaAccountStarter[] {
  const fallback = defaults.map((question) => ({
    label: question,
    prompt: question,
  }));
  if (own === undefined) return fallback;
  return own.hideDefaults ? own.items : [...own.items, ...fallback];
}
