/**
 * Refusals that happen before anything reaches the file system.
 *
 * Every rule here answers the same question: would this write leave a
 * composition a session could still compose from? A refusal returns a typed
 * failure and writes nothing.
 * @module host/validation
 */

import type { PersonaDraft } from "../types.js";
import { invalid } from "./errors.js";

/** Operator-set ceilings of one persona write. */
export interface PersonaLimits {
  /** Whether a `complete` persona may be written at all. */
  readonly allowComplete: boolean;
  /** Byte ceiling for prefix plus suffix. */
  readonly maxPersonaBytes: number;
}

/** Defaults matching the plugin's own config schema. */
export const DEFAULT_LIMITS: PersonaLimits = {
  allowComplete: true,
  maxPersonaBytes: 262144,
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
