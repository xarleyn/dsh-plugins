import type { QaNotesConfig, ResolvedQaSurfaceConfig } from "../types.js";

type ResolvedNotes = ResolvedQaSurfaceConfig["notes"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function one(state: { enabled?: boolean; template?: string }): {
  enabled: boolean;
  template: string;
} {
  return { enabled: state.enabled !== false, template: text(state.template) };
}

/**
 * The ambient model notes. Notes are advisory text, not capability: the
 * default is the current behavior (every note on, built-in wording), and an
 * empty template always resolves to the built-in text.
 */
export function resolveNotes(input: QaNotesConfig | undefined): ResolvedNotes {
  const raw = input ?? {};
  return {
    identity: one(raw.identity ?? {}),
    sources: {
      enabled: raw.sources?.enabled !== false,
      template: text(raw.sources?.template),
      fallbackTemplate: text(raw.sources?.fallbackTemplate),
    },
    delegation: one(raw.delegation ?? {}),
    documents: one(raw.documents ?? {}),
    sourcePriority: one(raw.sourcePriority ?? {}),
  };
}
