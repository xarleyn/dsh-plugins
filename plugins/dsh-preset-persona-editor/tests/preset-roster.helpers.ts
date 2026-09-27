/**
 * The roster fixture the reading tests share: presets that answer through the
 * same face the plugin reads the host with, and compositions the registry
 * renders for them.
 *
 * Nothing touches the file system — since `0.1.7-rc.2` the registry hands back
 * the composition text, so a test names that text and the reader sees it.
 */

import type {
  PresetComposition,
  PresetRosterFace,
} from "../src/host/preset-reader.js";
import type { PersonaDraft } from "../src/types.js";

/** A composition with a persona row and one row this editor must not touch. */
export const OWNED_PRESET = [
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  "  config:",
  "    prefix: You are the shipped demo persona.",
  "",
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

/** A composition that inherits the deployment's persona. */
export const INHERITED_PRESET = [
  "- id: tool-shell",
  "  name: '@deepseek-ai/dsh-tool-bash'",
  "",
].join("\n");

export const DRAFT: PersonaDraft = {
  prefix: "You are a careful reviewer.\nPrefer small, reviewable changes.",
  suffix: "Answer in the user's language.",
  complete: false,
  includeRuntimeContext: false,
};

/** One preset the fixture knows: what it declares, and whether it composes. */
export interface FixturePreset {
  /**
   * The composition the registry renders for this preset; `null` answers as a
   * registry that refuses the id.
   */
  readonly content: string | null;
  /** Why this preset cannot compose a session, the roster's own wording. */
  readonly broken?: string | undefined;
}

/** A roster over the presets a test registered, keyed by id. */
export function rosterOf(
  entries: Record<string, FixturePreset>,
  defaultId = "",
): PresetRosterFace {
  const resolve = async (id?: string) => {
    const key = id ?? defaultId;
    const entry = entries[key];
    if (entry === undefined) throw new Error("agent-preset/not-found");
    return {
      id: key,
      name: `preset ${key}`,
      ...(entry.broken === undefined ? {} : { broken: entry.broken }),
    };
  };
  const readDocument = async (
    agentPreset: string,
  ): Promise<PresetComposition> => {
    const entry = entries[agentPreset];
    if (entry === undefined || entry.content === null) {
      throw new Error("agent-preset/not-found");
    }
    return {
      agentPreset,
      content: entry.content,
      name: `preset ${agentPreset}`,
    };
  };
  return {
    list: async () =>
      await Promise.all(
        Object.entries(entries).map(async ([id, entry]) => ({
          id,
          name: `preset ${id}`,
          ...(entry.broken === undefined ? {} : { broken: entry.broken }),
        })),
      ),
    resolve,
    readDocument,
    defaultId,
  };
}
