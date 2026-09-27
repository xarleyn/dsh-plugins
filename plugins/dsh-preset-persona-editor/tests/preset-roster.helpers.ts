/**
 * The roster fixture the reading tests share: presets that answer through the
 * same face the plugin reads the host with, and compositions the registry
 * renders for them.
 *
 * Nothing touches the file system — since `0.1.7-rc.2` the registry hands back
 * the composition text, so a test names that text and the reader sees it.
 *
 * The refusals mirror the published `0.1.7-rc.2` registry rather than the
 * editor's guess at it: `resolve()` and `readDocument()` both throw
 * `agent-preset/not-found` for an id they do not hold (neither answers
 * `undefined`), and `readDocument()` renders a broken preset's declarations
 * exactly as it renders a healthy one — it never consults the activation
 * diagnostic. `withoutReadDocument` models a host inside the `<0.2.0` part of
 * the compatibility range that predates the method, and `answerNothing` one that
 * answers the method with a value that is not a composition.
 */

import type {
  PresetComposition,
  PresetRosterFace,
} from "../src/host/preset-reader.js";
import type { PersonaDraft } from "../src/types.js";

/** The refusal the published registry answers an unknown id with. */
function notKnown(id: string): Error {
  return new Error(`agent-preset/not-found: Unknown agent preset: ${id}`);
}

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

/** How a fixture roster differs from a healthy one. */
export interface RosterShape {
  /** Answer as a host whose registry publishes no `readDocument()`. */
  readonly withoutReadDocument?: boolean;
  /**
   * Answer `readDocument()` with nothing at all rather than a document or a
   * refusal. The published `0.1.7-rc.2` registry does neither — it resolves a
   * document or rejects with `agent-preset/not-found` — so this models a host
   * inside the `<0.2.0` part of the compatibility range that answers the method
   * with a value the face does not describe.
   */
  readonly answerNothing?: boolean;
}

/** A roster over the presets a test registered, keyed by id. */
export function rosterOf(
  entries: Record<string, FixturePreset>,
  defaultId = "",
  shape: RosterShape = {},
): PresetRosterFace {
  const resolve = async (id?: string) => {
    const key = id ?? defaultId;
    const entry = entries[key];
    if (entry === undefined) throw notKnown(key);
    return {
      id: key,
      name: `preset ${key}`,
      ...(entry.broken === undefined ? {} : { broken: entry.broken }),
    };
  };
  const readDocument = async (
    agentPreset: string,
  ): Promise<PresetComposition> => {
    if (shape.answerNothing) return undefined as unknown as PresetComposition;
    const entry = entries[agentPreset];
    if (entry === undefined || entry.content === null)
      throw notKnown(agentPreset);
    return {
      agentPreset,
      content: entry.content,
      name: `preset ${agentPreset}`,
    };
  };
  const roster: PresetRosterFace = {
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
  if (!shape.withoutReadDocument) return roster;
  return {
    list: roster.list,
    resolve: roster.resolve,
    defaultId: roster.defaultId,
  } as PresetRosterFace;
}
