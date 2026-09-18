/**
 * Refusals that happen before anything reaches the file system.
 *
 * Every rule here answers the same question: would this write leave a
 * composition a session could still compose from? A refusal returns a typed
 * failure and writes nothing.
 * @module host/validation
 */

import {
  MAX_SECTION_ORDER,
  DEFAULT_MAX_SECTIONS,
  DEFAULT_MAX_SECTIONS_BYTES,
  MAX_SECTION_NAME_LENGTH,
} from "../shared/prompt-sections.js";
import type { PersonaDraft, PromptSectionDraft } from "../types.js";
import { invalid } from "./errors.js";

/** Operator-set ceilings of one preset write. */
export interface PersonaLimits {
  /** Whether a `complete` persona may be written at all. */
  readonly allowComplete: boolean;
  /** Byte ceiling for prefix plus suffix. */
  readonly maxPersonaBytes: number;
  /** How many prompt sections one preset may contribute. */
  readonly maxSections: number;
  /** Byte ceiling for the section texts together. */
  readonly maxSectionsBytes: number;
}

/** Defaults matching the plugin's own config schema. */
export const DEFAULT_LIMITS: PersonaLimits = {
  allowComplete: true,
  maxPersonaBytes: 262144,
  maxSections: DEFAULT_MAX_SECTIONS,
  maxSectionsBytes: DEFAULT_MAX_SECTIONS_BYTES,
};

/** Fill in defaults for values the wire omitted, and reject foreign shapes. */
export function normalizeDraft(
  agentPreset: string,
  draft: Partial<PersonaDraft> | undefined,
): PersonaDraft {
  if (draft === undefined) {
    return {
      prefix: "",
      suffix: "",
      complete: false,
      includeRuntimeContext: true,
    };
  }
  const { prefix, suffix, complete, includeRuntimeContext } = draft;
  if (
    (prefix !== undefined && typeof prefix !== "string") ||
    (suffix !== undefined && typeof suffix !== "string") ||
    (complete !== undefined && typeof complete !== "boolean") ||
    (includeRuntimeContext !== undefined &&
      typeof includeRuntimeContext !== "boolean")
  ) {
    throw invalid(agentPreset, "the persona values are malformed");
  }
  return {
    prefix: prefix ?? "",
    suffix: suffix ?? "",
    complete: complete ?? false,
    includeRuntimeContext: includeRuntimeContext ?? true,
  };
}

/**
 * Refuse a draft this deployment must not write.
 * @param agentPreset - the preset being edited, for the diagnostic.
 * @param draft - the normalized values.
 * @param limits - operator-set ceilings.
 * @throws RemoteError `preset-persona/invalid` describing the refusal.
 */
export function validateDraft(
  agentPreset: string,
  draft: PersonaDraft,
  limits: PersonaLimits,
): void {
  if (draft.complete && draft.prefix.trim() === "") {
    throw invalid(
      agentPreset,
      "a complete persona with an empty prefix would leave the agent with no instructions",
    );
  }
  if (draft.complete && !limits.allowComplete) {
    throw invalid(
      agentPreset,
      "this deployment refuses complete personas; turn allowComplete on in the plugin configuration to permit them",
    );
  }
  const bytes =
    Buffer.byteLength(draft.prefix, "utf8") +
    Buffer.byteLength(draft.suffix, "utf8");
  if (bytes > limits.maxPersonaBytes) {
    throw invalid(
      agentPreset,
      `the persona is ${bytes} bytes; this deployment limits it to ${limits.maxPersonaBytes}`,
    );
  }
}

/** The message of any thrown value, for a refusal's reason text. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a section name can be carried as a plain, one-line identifier. */
function usableSectionName(name: string): boolean {
  if (name === "" || name.length > MAX_SECTION_NAME_LENGTH) return false;
  if (name !== name.trim()) return false;
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Fill in defaults for the section list and reject shapes the wire should never
 * have carried.
 * @param agentPreset - the preset being edited, for the diagnostic.
 * @param input - the list as it arrived.
 * @returns the normalized list.
 * @throws RemoteError `preset-persona/invalid`.
 */
export function normalizeSections(
  agentPreset: string,
  input: readonly Partial<PromptSectionDraft>[] | undefined,
): PromptSectionDraft[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw invalid(agentPreset, "the prompt sections are malformed");
  }
  return input.map((section) => {
    if (section === null || typeof section !== "object") {
      throw invalid(agentPreset, "the prompt sections are malformed");
    }
    const { name, order, text, enabled } = section;
    if (
      (name !== undefined && typeof name !== "string") ||
      (order !== undefined && typeof order !== "number") ||
      (text !== undefined && typeof text !== "string") ||
      (enabled !== undefined && typeof enabled !== "boolean")
    ) {
      throw invalid(agentPreset, "the prompt sections are malformed");
    }
    return {
      name: name ?? "",
      order: order ?? 0,
      text: text ?? "",
      enabled: enabled ?? true,
    };
  });
}

/**
 * Refuse a section list this deployment must not write.
 *
 * The rules are the ones the harness itself enforces at mount — unique names
 * within one layer, a finite order — plus the ones that keep a hand-edited
 * composition readable: a name that is an identifier, text that is not blank,
 * and ceilings an operator can set.
 * @param agentPreset - the preset being edited, for the diagnostic.
 * @param sections - the normalized list.
 * @param limits - operator-set ceilings.
 * @throws RemoteError `preset-persona/invalid` describing the refusal.
 */
export function validateSections(
  agentPreset: string,
  sections: readonly PromptSectionDraft[],
  limits: PersonaLimits,
): void {
  if (sections.length > limits.maxSections) {
    throw invalid(
      agentPreset,
      `the preset carries ${sections.length} prompt sections; this deployment allows ${limits.maxSections}`,
    );
  }
  const seen = new Set<string>();
  let bytes = 0;
  for (const section of sections) {
    if (!usableSectionName(section.name)) {
      throw invalid(
        agentPreset,
        `a section name must be a single line of at most ${MAX_SECTION_NAME_LENGTH} characters without surrounding space: ${JSON.stringify(section.name)}`,
      );
    }
    if (seen.has(section.name)) {
      throw invalid(
        agentPreset,
        `two sections share the name ${JSON.stringify(section.name)}; the harness refuses duplicate sections in one composition`,
      );
    }
    seen.add(section.name);
    if (
      !Number.isInteger(section.order) ||
      Math.abs(section.order) > MAX_SECTION_ORDER
    ) {
      throw invalid(
        agentPreset,
        `section ${JSON.stringify(section.name)} has order ${String(section.order)}; it must be a whole number within ±${MAX_SECTION_ORDER}`,
      );
    }
    if (section.text.trim() === "") {
      throw invalid(
        agentPreset,
        `section ${JSON.stringify(section.name)} has no text; turn it off instead of emptying it`,
      );
    }
    bytes += Buffer.byteLength(section.text, "utf8");
  }
  if (bytes > limits.maxSectionsBytes) {
    throw invalid(
      agentPreset,
      `the prompt sections are ${bytes} bytes; this deployment limits them to ${limits.maxSectionsBytes}`,
    );
  }
}
