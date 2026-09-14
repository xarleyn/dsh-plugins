import type { QaSkillDiagnostic, QaSkillDiagnosticCode } from "../types.js";

/**
 * The rules of the `SKILL.md` format that need no YAML: the name grammar, the
 * declared-tool list, the draft limits, and where a personal root may sit.
 *
 * This module is deliberately free of Node builtins *and* of the YAML
 * dependency, because the browser editor imports it: a YAML library ships a
 * Node build beside its browser one, and the DSH module loader has no engine
 * for the `require("process")` that build contains. The parser and serializer
 * that do need YAML live in `skill-file.js`, which only the Host loads — the
 * editor asks the Host for the file a draft would write and for the
 * authoritative diagnostics, and shows its own answer immediately for the
 * rules below.
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

/** DSH's skill-name grammar: the registry refuses anything else outright. */
export const QA_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Tool names are stored verbatim in canonical space-separated form, so the
 * accepted shape has to exclude whitespace and YAML-significant characters.
 */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;

/** Frontmatter keys the editor owns. */
export const KNOWN_SKILL_FIELDS = new Set([
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
export const PRESERVED_SKILL_FIELDS = new Set([
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

/** The reason a candidate name cannot be used, or null when it can. */
export function skillNameProblem(
  value: string,
): "name-required" | "name-invalid" | null {
  if (value === "") return "name-required";
  if (value.length > QA_SKILL_NAME_MAX) return "name-invalid";
  return QA_SKILL_NAME_PATTERN.test(value) ? null : "name-invalid";
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

export function skillWarning(
  code: QaSkillDiagnosticCode,
  field: string | null,
  detail: string | null,
): QaSkillDiagnostic {
  return { code, severity: "warning", field, detail };
}

/** Byte length of the text a Save would write, in UTF-8. */
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
  /**
   * Byte length of the serialized file. Omitted by a caller that cannot
   * serialize — the browser editor — so the size rule stays on the Host,
   * which knows both the operator's ceiling and the file it would write.
   */
  readonly sizeBytes?: number | undefined;
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
 * write time; running it in the browser only makes the editor immediate, it is
 * not the authority.
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
      skillWarning(
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
      skillWarning(
        "when-to-use-too-long",
        "whenToUse",
        String(QA_SKILL_WHEN_TO_USE_MAX),
      ),
    );
  }

  if (!input.modelInvocable && !input.userInvocable) {
    diagnostics.push(skillWarning("invocation-never", "invocation", null));
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
        diagnostics.push(skillWarning("tool-unavailable", "tools", tool));
      }
    }
  }

  const maxBytes = input.maxBytes ?? QA_SKILL_FILE_MAX_BYTES;
  if (input.sizeBytes !== undefined && input.sizeBytes > maxBytes) {
    error("file-too-large", null, String(maxBytes));
  }

  for (const key of input.extraFieldNames ?? []) {
    if (KNOWN_SKILL_FIELDS.has(key) || PRESERVED_SKILL_FIELDS.has(key))
      continue;
    diagnostics.push(skillWarning("unknown-field", null, key));
  }

  return diagnostics;
}
