import type { QaAccountIdentityField, QaAccountProfile } from "./types.js";

/**
 * Profile shape, limits, and the normalization both halves of the plugin
 * agree on. Deliberately free of Node built-ins: the configuration resolver
 * and the browser-side form import these same limits, and a Host-only import
 * here would drag the accounts store into the client bundle.
 */

/** Longest accepted full name. */
export const QA_PROFILE_MAX_FULL_NAME = 200;
/** Longest accepted value of one external-system handle. */
export const QA_PROFILE_MAX_IDENTITY_VALUE = 200;
/** Most handles one profile may carry. */
export const QA_PROFILE_MAX_IDENTITIES = 16;
/** Handle keys are lowercase labels; the deployment declares which ones exist. */
export const QA_PROFILE_IDENTITY_KEY = /^[a-z][a-z0-9_-]{0,31}$/u;
/** Longest accepted display label of one declared handle field. */
export const QA_PROFILE_MAX_IDENTITY_LABEL = 40;
/** Most handle fields one deployment may declare. */
export const QA_PROFILE_MAX_IDENTITY_FIELDS = 8;
/** Default cap on the user's free-form agent guidance. */
export const QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX = 2_000;
/** Bounds within which a deployment may set that cap. */
export const QA_PROFILE_INSTRUCTIONS_MAX_MIN = 200;
export const QA_PROFILE_INSTRUCTIONS_MAX_MAX = 20_000;

/** Every control character except line feed: stripped from both field kinds. */
function stripControlCharacters(value: string, keepLineFeeds: boolean): string {
  let cleaned = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    if (!control || (keepLineFeeds && code === 0x0a)) cleaned += character;
  }
  return cleaned;
}

/** The profile of an account that never filled one in. */
export function emptyProfile(): QaAccountProfile {
  return { fullName: "", identities: {}, instructions: "", updatedAt: null };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Drop a trailing lone surrogate left by a cut inside a surrogate pair. */
function dropSplitSurrogate(value: string): string {
  return /[\ud800-\udbff]$/u.test(value) ? value.slice(0, -1) : value;
}

/**
 * One single-line field: control characters out, whitespace runs collapsed to
 * a space, trimmed to at most `maxLength` characters. Shared with the starter
 * editor, whose button label obeys the same rules.
 */
export function cleanLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const cleaned = stripControlCharacters(value, false)
    .replace(/\s+/gu, " ")
    .trim();
  return dropSplitSurrogate(cleaned.slice(0, maxLength));
}

/**
 * One multi-line field: line feeds survive (three or more collapse to a blank
 * line), every other control character is dropped, and the result is trimmed
 * to at most `maxLength` characters. Shared with the starter editor, whose
 * sent prompt obeys the same rules.
 */
export function cleanBlock(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const cleaned = stripControlCharacters(value.replace(/\r\n?/gu, "\n"), true)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return dropSplitSurrogate(cleaned.slice(0, maxLength));
}

/** Handle keys of one stored profile, in insertion order, shape-checked. */
function cleanIdentities(value: unknown): Readonly<Record<string, string>> {
  const raw = asRecord(value);
  if (raw === undefined) return {};
  const identities: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!QA_PROFILE_IDENTITY_KEY.test(key)) continue;
    const cleaned = cleanLine(entry, QA_PROFILE_MAX_IDENTITY_VALUE);
    if (cleaned === "") continue;
    if (Object.keys(identities).length >= QA_PROFILE_MAX_IDENTITIES) break;
    identities[key] = cleaned;
  }
  return identities;
}

/**
 * Read one stored (or wire-delivered) profile into its public shape. Unknown
 * or hand-edited input degrades to the readable subset instead of throwing:
 * a malformed profile must never cost the account its session. Overlong text
 * is truncated here — the write path rejects it with a message instead.
 */
export function normalizeProfile(value: unknown): QaAccountProfile {
  const raw = asRecord(value);
  if (raw === undefined) return emptyProfile();
  const updatedAt = raw.updatedAt;
  return {
    fullName: cleanLine(raw.fullName, QA_PROFILE_MAX_FULL_NAME),
    identities: cleanIdentities(raw.identities),
    instructions: cleanBlock(raw.instructions, QA_PROFILE_INSTRUCTIONS_MAX_MAX),
    updatedAt:
      typeof updatedAt === "string" && updatedAt !== "" ? updatedAt : null,
  };
}

/** Validated profile values, before the store stamps `updatedAt`. */
export interface QaProfileWrite {
  readonly fullName: string;
  readonly identities: Readonly<Record<string, string>>;
  readonly instructions: string;
}

export type QaProfileWriteResult =
  | { readonly ok: true; readonly value: QaProfileWrite }
  | { readonly ok: false; readonly message: string };

export interface QaProfileWriteOptions {
  readonly instructionsMaxLength: number;
  /**
   * Fields the deployment declares; a write may name only these keys. Omit to
   * check the key shape alone — the operator CLI path, where the writer is the
   * same person who owns the configuration.
   */
  readonly identities?: readonly QaAccountIdentityField[];
}

/**
 * Validate one full-replace profile write. Values are cleaned the same way
 * the read path cleans them, so what a caller sends is what the prompt will
 * later render; limits are refused with a message instead of truncated, so a
 * user pasting an essay learns why it was not stored.
 */
export function validateProfileWrite(
  input: unknown,
  options: QaProfileWriteOptions,
): QaProfileWriteResult {
  const raw = asRecord(input);
  if (raw === undefined) {
    return { ok: false, message: "the profile payload is not an object" };
  }
  const fullName = cleanLine(raw.fullName, Number.MAX_SAFE_INTEGER);
  if (fullName.length > QA_PROFILE_MAX_FULL_NAME) {
    return {
      ok: false,
      message: `the full name must be at most ${QA_PROFILE_MAX_FULL_NAME} characters`,
    };
  }
  const instructions = cleanBlock(raw.instructions, Number.MAX_SAFE_INTEGER);
  if (instructions.length > options.instructionsMaxLength) {
    return {
      ok: false,
      message: `the agent instructions must be at most ${options.instructionsMaxLength} characters`,
    };
  }
  if (
    raw.identities !== undefined &&
    raw.identities !== null &&
    asRecord(raw.identities) === undefined
  ) {
    return { ok: false, message: "the identities payload is not an object" };
  }
  const declared = new Set(
    (options.identities ?? []).map((field) => field.key),
  );
  const identities: Record<string, string> = {};
  for (const [key, entry] of Object.entries(asRecord(raw.identities) ?? {})) {
    const cleaned = cleanLine(entry, Number.MAX_SAFE_INTEGER);
    // An empty value clears the handle; the key itself is then irrelevant.
    if (cleaned === "") continue;
    if (!QA_PROFILE_IDENTITY_KEY.test(key)) {
      return { ok: false, message: `"${key}" is not a usable identity key` };
    }
    if (options.identities !== undefined && !declared.has(key)) {
      return {
        ok: false,
        message: `this deployment declares no "${key}" identity field`,
      };
    }
    if (cleaned.length > QA_PROFILE_MAX_IDENTITY_VALUE) {
      return {
        ok: false,
        message: `the "${key}" value must be at most ${QA_PROFILE_MAX_IDENTITY_VALUE} characters`,
      };
    }
    identities[key] = cleaned;
  }
  if (Object.keys(identities).length > QA_PROFILE_MAX_IDENTITIES) {
    return {
      ok: false,
      message: `at most ${QA_PROFILE_MAX_IDENTITIES} identities can be stored`,
    };
  }
  return { ok: true, value: { fullName, identities, instructions } };
}

export type QaIdentityFieldsResult =
  | { readonly ok: true; readonly value: readonly QaAccountIdentityField[] }
  | { readonly ok: false; readonly message: string };

/**
 * Validate the deployment's declared handle fields: the profile form renders
 * one input per entry and the prompt names exactly these, so a typo in a key
 * becomes a refusal at configuration time rather than a silent no-op.
 */
export function validateIdentityFields(value: unknown): QaIdentityFieldsResult {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: "identities must be a list of fields" };
  }
  if (value.length > QA_PROFILE_MAX_IDENTITY_FIELDS) {
    return {
      ok: false,
      message: `at most ${QA_PROFILE_MAX_IDENTITY_FIELDS} identity fields are supported`,
    };
  }
  const fields: QaAccountIdentityField[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const raw = asRecord(entry);
    if (raw === undefined) {
      return { ok: false, message: "each identity field must be an object" };
    }
    const key = typeof raw.key === "string" ? raw.key.trim().toLowerCase() : "";
    if (!QA_PROFILE_IDENTITY_KEY.test(key)) {
      return {
        ok: false,
        message: `identity field keys are lowercase labels such as "jira"; got ${JSON.stringify(raw.key ?? null)}`,
      };
    }
    if (seen.has(key)) {
      return {
        ok: false,
        message: `identity field "${key}" is declared twice`,
      };
    }
    seen.add(key);
    const label = cleanLine(raw.label, QA_PROFILE_MAX_IDENTITY_LABEL) || key;
    fields.push({ key, label });
  }
  return { ok: true, value: fields };
}
