import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  QaSkillDiagnostic,
  QaSkillDiagnosticCode,
  QaSkillJsonValue,
} from "../types.js";

/**
 * The portable `SKILL.md` format, deliberately free of Node builtins: the
 * Host service and the browser editor import the same parser and serializer,
 * so the editor's live preview cannot drift from what a Save writes, and the
 * frontmatter grammar stays a single copy.
 *
 * The grammar mirrors the upstream filesystem provider, which is what decides
 * whether a file becomes a skill at all: `---` fences on the first and a later
 * line, a YAML mapping, a kebab-case `name`, a non-empty `description`, the
 * `user-invocable` / `disable-model-invocation` booleans with the accepted
 * spellings, and silent tolerance of every other key. Where the upstream
 * provider would drop a file entirely, this parser reports a blocking code so
 * the editor can say why the skill never reaches the catalog.
 */

/** Name length cap; the upstream grammar itself is unbounded. */
export const QA_SKILL_NAME_MAX = 64;
export const QA_SKILL_DESCRIPTION_MAX = 1024;
export const QA_SKILL_WHEN_TO_USE_MAX = 2048;
/** One skill file's own ceiling, before any resource directory is considered. */
export const QA_SKILL_FILE_MAX_BYTES = 256 * 1024;
export const QA_SKILL_MAX_BYTES_MIN = 4096;
export const QA_SKILL_MAX_BYTES_MAX = 16 * 1024 * 1024;
export const QA_SKILL_MAX_TOOLS = 256;

/**
 * Whether the feature is on for a deployment that could host it. The resolver
 * still turns it off wherever accounts or per-account directories are absent:
 * this is the operator's intent, not a capability.
 */
export const QA_SKILL_ENABLED_BY_DEFAULT = true;

/** Where personal skills live below one account's own workspace directory. */
export const QA_SKILL_DEFAULT_RELATIVE_ROOT = ".dsh/skills";
export const QA_SKILL_RELATIVE_ROOT_MAX = 512;

/**
 * Whether a configured `relativeRoot` may be resolved below a personal root.
 * Only a relative, ordinary path qualifies: the value decides where the
 * filesystem boundary of the feature sits, so an absolute path or one
 * climbing out would move the boundary rather than relocate inside it.
 */
export function skillRelativeRootProblem(value: string): string | null {
  const text = value.trim();
  if (text === "") return "must not be empty";
  if (text.length > QA_SKILL_RELATIVE_ROOT_MAX) return "is too long";
  if (text.includes("\0")) return "must not contain null bytes";
  if (/^([a-zA-Z]:|[/\\])/u.test(text)) return "must be a relative path";
  const segments = text
    .split(/[/\\]+/u)
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return "must name a directory";
  if (segments.includes("..")) return "must not contain '..'";
  return null;
}

/** The directory segments of an already-validated relative root. */
export function skillRelativeRootSegments(value: string): readonly string[] {
  return value
    .split(/[/\\]+/u)
    .filter((segment) => segment !== "" && segment !== ".");
}

/** DSH's skill-name grammar: the registry refuses anything else outright. */
export const QA_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Tool names are stored verbatim in canonical space-separated form, so the
 * accepted shape has to exclude whitespace and YAML-significant characters.
 */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;

/** Frontmatter keys the editor owns. */
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "whenToUse",
  "user-invocable",
  "disable-model-invocation",
  "allowed-tools",
]);

/**
 * Agent Skills fields the editor preserves without offering a control for
 * them. Anything outside both sets is still preserved; it only earns a
 * warning that the deployment's editor does not know the field.
 */
const PRESERVED_FIELDS = new Set([
  "license",
  "compatibility",
  "metadata",
  "disallowed-tools",
  "version",
  "context",
  "model",
  "argument-hint",
  "arguments",
]);

/** Spellings the upstream parser throws on, dropping the skill with them. */
const LEGACY_INVOCATION_KEYS = [
  "disableModelInvocation",
  "modelInvocable",
  "userInvocable",
];

const TRUE_WORDS = new Set(["true", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0"]);

/** The parsed shape of one skill file, without its generated diagnostics. */
export interface QaSkillFileContents {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  /** Declared tool names dropped as unusable; reported, never silently kept. */
  readonly rejectedTools: readonly string[];
  /** Every frontmatter key the editor does not own, in document order. */
  readonly extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>;
  readonly body: string;
  /** Non-blocking anomalies found while reading the file. */
  readonly warnings: readonly QaSkillDiagnostic[];
}

/**
 * A parse either yields contents or the single reason the file cannot become
 * a skill. The blocking codes carry the upstream reason: `frontmatter-missing`
 * covers both an absent block and a file that is nothing but a body.
 */
export type QaSkillFileParse =
  | { readonly ok: true; readonly value: QaSkillFileContents }
  | {
      readonly ok: false;
      readonly code: QaSkillDiagnosticCode;
      readonly detail: string | null;
    };

export interface QaSkillFileDraft {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  readonly extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>;
  readonly body: string;
}

/**
 * Coerce one YAML node to a JSON value, or undefined when JSON cannot carry
 * it: preserved frontmatter crosses a JSON bridge, so what crosses it has to
 * be exactly what a Save writes back.
 */
export function toJsonValue(value: unknown): QaSkillJsonValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (Array.isArray(value)) {
    const items: QaSkillJsonValue[] = [];
    for (const entry of value) {
      const json = toJsonValue(entry);
      if (json === undefined) return undefined;
      items.push(json);
    }
    return items;
  }
  // Only a plain mapping survives: a Buffer, a Date or any other class
  // instance would otherwise be flattened into its own enumerable keys.
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const asObject = asRecord(value);
  if (asObject === undefined) return undefined;
  const result: Record<string, QaSkillJsonValue> = {};
  for (const [key, entry] of Object.entries(asObject)) {
    const json = toJsonValue(entry);
    if (json === undefined) return undefined;
    result[key] = json;
  }
  return result;
}

/** The reason a candidate name cannot be used, or null when it can. */
export function skillNameProblem(
  value: string,
): "name-required" | "name-invalid" | null {
  if (value === "") return "name-required";
  if (value.length > QA_SKILL_NAME_MAX) return "name-invalid";
  return QA_SKILL_NAME_PATTERN.test(value) ? null : "name-invalid";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

type FrontmatterSplit =
  | { readonly kind: "ok"; readonly yamlText: string; readonly body: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unterminated" };

/**
 * Split the leading `---` block off a skill file. A file whose first line is
 * not the fence is not a skill at all: the body alone carries no name.
 */
function splitFrontmatter(raw: string): FrontmatterSplit {
  const text = raw.replace(/^\uFEFF/u, "");
  const firstEnd = text.indexOf("\n");
  if (firstEnd < 0) return { kind: "missing" };
  if (text.slice(0, firstEnd).replace(/\r$/u, "") !== "---") {
    return { kind: "missing" };
  }
  let cursor = firstEnd + 1;
  for (;;) {
    const lineEnd = text.indexOf("\n", cursor);
    const end = lineEnd < 0 ? text.length : lineEnd;
    if (text.slice(cursor, end).replace(/\r$/u, "") === "---") {
      return {
        kind: "ok",
        yamlText: text.slice(firstEnd + 1, cursor),
        body: text.slice(end + 1),
      };
    }
    if (lineEnd < 0) return { kind: "unterminated" };
    cursor = lineEnd + 1;
  }
}

/** Read one frontmatter boolean with the spellings upstream accepts. */
function frontmatterBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return undefined;
}

export interface QaToolListNormalization {
  readonly tools: readonly string[];
  /** Entries that are not usable tool names; reported, never silently kept. */
  readonly rejected: readonly string[];
}

/**
 * Read a declared tool list. The canonical form is one space-separated
 * scalar, but an array (and comma separators) are accepted for compatibility
 * with skills authored elsewhere, and every form normalizes to the canonical
 * deduplicated order.
 */
export function normalizeAllowedTools(
  value: unknown,
): QaToolListNormalization | undefined {
  if (value === undefined || value === null) return { tools: [], rejected: [] };
  const candidates: string[] = [];
  if (typeof value === "string") {
    candidates.push(...value.split(/[\s,]+/u));
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string") return undefined;
      candidates.push(...entry.split(/[\s,]+/u));
    }
  } else {
    return undefined;
  }
  const tools: string[] = [];
  const rejected: string[] = [];
  for (const candidate of candidates) {
    const name = candidate.trim();
    if (name === "") continue;
    if (!TOOL_NAME_PATTERN.test(name)) {
      if (!rejected.includes(name)) rejected.push(name);
      continue;
    }
    if (!tools.includes(name)) tools.push(name);
  }
  return { tools, rejected };
}

function warning(
  code: QaSkillDiagnosticCode,
  field: string | null,
  detail: string | null,
): QaSkillDiagnostic {
  return { code, severity: "warning", field, detail };
}

/** The first line of a parser message, clipped for the wire. */
function firstLine(message: string): string {
  return (message.split("\n")[0] ?? "").slice(0, 200);
}

/** Parse one `SKILL.md` into its canonical shape plus read-time warnings. */
export function parseSkillFile(raw: string): QaSkillFileParse {
  const split = splitFrontmatter(raw);
  if (split.kind === "missing") {
    return { ok: false, code: "frontmatter-missing", detail: null };
  }
  if (split.kind === "unterminated") {
    return { ok: false, code: "frontmatter-invalid", detail: "unterminated" };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(split.yamlText);
  } catch (error) {
    return {
      ok: false,
      code: "frontmatter-invalid",
      detail: firstLine(error instanceof Error ? error.message : String(error)),
    };
  }
  const front = asRecord(parsed);
  if (front === undefined) {
    return { ok: false, code: "frontmatter-invalid", detail: "not-a-mapping" };
  }

  const rawName = front.name;
  const name =
    typeof rawName === "string"
      ? rawName.trim()
      : rawName === undefined
        ? ""
        : String(rawName);
  const nameProblem = skillNameProblem(name);
  if (nameProblem !== null) {
    return { ok: false, code: nameProblem, detail: null };
  }

  const rawDescription = front.description;
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (description === "") {
    return { ok: false, code: "description-required", detail: null };
  }

  const legacy = LEGACY_INVOCATION_KEYS.find((key) => key in front);
  if (legacy !== undefined) {
    return { ok: false, code: "invocation-legacy-key", detail: legacy };
  }

  const warnings: QaSkillDiagnostic[] = [];
  let modelInvocable = true;
  let userInvocable = true;
  for (const key of ["disable-model-invocation", "user-invocable"] as const) {
    if (!(key in front)) continue;
    const value = frontmatterBoolean(front[key]);
    if (value === undefined) {
      return { ok: false, code: "invocation-invalid", detail: key };
    }
    if (key === "disable-model-invocation") modelInvocable = !value;
    else userInvocable = value;
  }

  let whenToUse: string | null = null;
  if (front.whenToUse !== undefined && front.whenToUse !== null) {
    if (typeof front.whenToUse === "string") {
      const trimmed = front.whenToUse.trim();
      whenToUse = trimmed === "" ? null : trimmed;
    } else {
      warnings.push(warning("field-type-invalid", "whenToUse", "whenToUse"));
    }
  }

  const normalized = normalizeAllowedTools(front["allowed-tools"]);
  if (normalized === undefined) {
    return { ok: false, code: "allowed-tools-invalid", detail: null };
  }
  if (normalized.rejected.length > 0) {
    warnings.push(
      warning("tool-name-invalid", "tools", normalized.rejected.join(", ")),
    );
  }

  const extraFrontmatter: Record<string, QaSkillJsonValue> = {};
  for (const [key, value] of Object.entries(front)) {
    if (KNOWN_FIELDS.has(key)) continue;
    const json = toJsonValue(value);
    if (json === undefined) {
      // A YAML-only node (a tagged timestamp, a binary) cannot cross the JSON
      // bridge this editor reads over; say so rather than drop it in silence.
      warnings.push(warning("field-type-invalid", null, key));
      continue;
    }
    extraFrontmatter[key] = json;
    if (!PRESERVED_FIELDS.has(key)) {
      warnings.push(warning("unknown-field", null, key));
    }
  }

  return {
    ok: true,
    value: {
      name,
      description,
      whenToUse,
      modelInvocable,
      userInvocable,
      allowedTools: normalized.tools,
      rejectedTools: normalized.rejected,
      extraFrontmatter,
      body: split.body.trim(),
      warnings,
    },
  };
}

/**
 * Write one `SKILL.md` from a draft. Known fields are emitted first in the
 * canonical order every reader of this plugin sees; preserved foreign fields
 * follow in the order they were read, so a skill authored elsewhere keeps its
 * extra frontmatter across a Save in the editor.
 */
export function serializeSkillFile(draft: QaSkillFileDraft): string {
  const front: Record<string, unknown> = {
    name: draft.name,
    description: draft.description,
  };
  const whenToUse = draft.whenToUse?.trim() ?? "";
  if (whenToUse !== "") front.whenToUse = whenToUse;
  front["user-invocable"] = draft.userInvocable;
  front["disable-model-invocation"] = !draft.modelInvocable;
  if (draft.allowedTools.length > 0) {
    front["allowed-tools"] = draft.allowedTools.join(" ");
  }
  for (const [key, value] of Object.entries(draft.extraFrontmatter)) {
    if (value === undefined || key in front) continue;
    front[key] = value;
  }
  const yamlText = stringifyYaml(front, { lineWidth: 0 }).trimEnd();
  const body = draft.body.trim();
  return body === ""
    ? `---\n${yamlText}\n---\n`
    : `---\n${yamlText}\n---\n\n${body}\n`;
}

/**
 * The markdown body of a skill file, whether or not its frontmatter parses.
 * A file the editor cannot open still has to show its instructions, so a
 * malformed block yields the text below it and a file without a block yields
 * itself.
 */
export function skillFileBody(raw: string): string {
  const split = splitFrontmatter(raw);
  return split.kind === "ok" ? split.body.trim() : raw.trim();
}

/** Byte length of the file a Save would write, in UTF-8. */
export function skillFileBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface QaSkillValidationInput {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  /** Byte length of the serialized file. */
  readonly sizeBytes: number;
  /** Operator-configured ceiling; the built-in default applies when omitted. */
  readonly maxBytes?: number | undefined;
  /**
   * Names the current QA scope can actually use. Omitted when the catalog is
   * unknown: a missing catalog must not turn every tool into a warning.
   */
  readonly availableTools?: readonly string[] | undefined;
  /** Tool names submitted through the picker that are not usable names. */
  readonly rejectedTools?: readonly string[] | undefined;
  /** Frontmatter keys carried over from the file, for the unknown-field notice. */
  readonly extraFieldNames?: readonly string[] | undefined;
}

/**
 * Validate an editor draft. Every rule here is enforced again on the Host at
 * write time; running the same function in the browser only makes the editor
 * immediate, it is not the authority.
 */
export function validateSkillDraft(
  input: QaSkillValidationInput,
): readonly QaSkillDiagnostic[] {
  const diagnostics: QaSkillDiagnostic[] = [];
  const error = (
    code: QaSkillDiagnosticCode,
    field: string | null,
    detail: string | null,
  ): void => {
    diagnostics.push({ code, severity: "error", field, detail });
  };

  const nameProblem = skillNameProblem(input.name);
  if (nameProblem !== null) error(nameProblem, "name", null);

  if (input.description.trim() === "") {
    error("description-required", "description", null);
  } else if (input.description.length > QA_SKILL_DESCRIPTION_MAX) {
    diagnostics.push(
      warning(
        "description-too-long",
        "description",
        String(QA_SKILL_DESCRIPTION_MAX),
      ),
    );
  }

  if (
    input.whenToUse !== null &&
    input.whenToUse.length > QA_SKILL_WHEN_TO_USE_MAX
  ) {
    diagnostics.push(
      warning(
        "when-to-use-too-long",
        "whenToUse",
        String(QA_SKILL_WHEN_TO_USE_MAX),
      ),
    );
  }

  if (!input.modelInvocable && !input.userInvocable) {
    diagnostics.push(warning("invocation-never", "invocation", null));
  }

  const rejected = input.rejectedTools ?? [];
  if (rejected.length > 0) {
    error("tool-name-invalid", "tools", rejected.join(", "));
  }
  if (input.allowedTools.length > QA_SKILL_MAX_TOOLS) {
    error("tools-too-many", "tools", String(QA_SKILL_MAX_TOOLS));
  }
  const available = input.availableTools;
  if (available !== undefined) {
    const known = new Set(available);
    for (const tool of input.allowedTools) {
      if (!known.has(tool)) {
        diagnostics.push(warning("tool-unavailable", "tools", tool));
      }
    }
  }

  const maxBytes = input.maxBytes ?? QA_SKILL_FILE_MAX_BYTES;
  if (input.sizeBytes > maxBytes) {
    error("file-too-large", null, String(maxBytes));
  }

  for (const key of input.extraFieldNames ?? []) {
    if (KNOWN_FIELDS.has(key) || PRESERVED_FIELDS.has(key)) continue;
    diagnostics.push(warning("unknown-field", null, key));
  }

  return diagnostics;
}

/** Whether a diagnostic set blocks a Save. */
export function hasBlockingSkillDiagnostic(
  diagnostics: readonly QaSkillDiagnostic[],
): boolean {
  return diagnostics.some((entry) => entry.severity === "error");
}
