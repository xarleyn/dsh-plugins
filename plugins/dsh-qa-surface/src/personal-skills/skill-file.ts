import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  QaSkillDiagnostic,
  QaSkillDiagnosticCode,
  QaSkillJsonValue,
} from "../types.js";
import {
  KNOWN_SKILL_FIELDS,
  PRESERVED_SKILL_FIELDS,
  normalizeAllowedTools,
  skillNameProblem,
  skillWarning,
} from "./skill-format.js";

/**
 * The YAML half of the portable `SKILL.md` format: reading a file into its
 * canonical shape, and writing one back. Only the Host loads this module — the
 * editor reads a skill through the Host's DTOs and asks it to serialize a
 * draft, because a YAML library carries a Node build whose `require` calls the
 * browser module loader cannot answer. The rules that need no YAML live in
 * `skill-format.js`, which both sides share.
 *
 * The grammar mirrors the upstream filesystem provider, which is what decides
 * whether a file becomes a skill at all: `---` fences on the first and a later
 * line, a YAML mapping, a kebab-case `name`, a non-empty `description`, the
 * `user-invocable` / `disable-model-invocation` booleans with the accepted
 * spellings, and silent tolerance of every other key. Where the upstream
 * provider would drop a file entirely, this parser reports a blocking code so
 * the editor can say why the skill never reaches the catalog.
 */

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
      warnings.push(
        skillWarning("field-type-invalid", "whenToUse", "whenToUse"),
      );
    }
  }

  const normalized = normalizeAllowedTools(front["allowed-tools"]);
  if (normalized === undefined) {
    return { ok: false, code: "allowed-tools-invalid", detail: null };
  }
  if (normalized.rejected.length > 0) {
    warnings.push(
      skillWarning(
        "tool-name-invalid",
        "tools",
        normalized.rejected.join(", "),
      ),
    );
  }

  const extraFrontmatter: Record<string, QaSkillJsonValue> = {};
  for (const [key, value] of Object.entries(front)) {
    if (KNOWN_SKILL_FIELDS.has(key)) continue;
    const json = toJsonValue(value);
    if (json === undefined) {
      // A YAML-only node (a tagged timestamp, a binary) cannot cross the JSON
      // bridge this editor reads over; say so rather than drop it in silence.
      warnings.push(skillWarning("field-type-invalid", null, key));
      continue;
    }
    extraFrontmatter[key] = json;
    if (!PRESERVED_SKILL_FIELDS.has(key)) {
      warnings.push(skillWarning("unknown-field", null, key));
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

export * from "./skill-format.js";
