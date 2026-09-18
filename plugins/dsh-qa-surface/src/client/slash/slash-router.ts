import type { QaSlashCatalogEntry } from "../../types.js";
import { parseSlashLine, skillGestures } from "../../slash/parser.js";

/**
 * Where one composer draft should go.
 *
 * The composer used to have a single path — `sendPrompt` — with a guard that
 * turned every `/`-leading line away. That guard is now the `disabled` case
 * below, and everything else is decided here, in one place, from the draft and
 * the catalog alone. Keeping it pure is what makes the ambiguous, unknown and
 * withheld cases testable without a browser or a Host.
 */
export type QaSlashRoute =
  /**
   * Ordinary text: the model gets it, exactly as before this feature. It may
   * still name a skill this deployment withholds — the turn runs, and the
   * surface says so rather than letting the user believe it took effect.
   */
  | { readonly kind: "prompt"; readonly withheld?: readonly string[] }
  /** A user-invocable skill: the native prompt path carries the gesture. */
  | { readonly kind: "skill"; readonly entry: QaSlashCatalogEntry }
  /** A human command: the Host's command runtime answers it, the model never sees it. */
  | { readonly kind: "command"; readonly entry: QaSlashCatalogEntry }
  /** Nothing by that name is offered here. */
  | { readonly kind: "unknown"; readonly name: string }
  /** A skill and a command share the name; only the user may choose. */
  | {
      readonly kind: "ambiguous";
      readonly name: string;
      readonly entries: readonly QaSlashCatalogEntry[];
    }
  /** The catalog could not be read, so no `/name` can be classified. */
  | { readonly kind: "unavailable"; readonly name: string }
  /** The deployment runs with the slash interface off. */
  | { readonly kind: "disabled" };

export interface ResolveSlashRouteInput {
  readonly text: string;
  readonly enabled: boolean;
  readonly catalogReady: boolean;
  readonly entries: readonly QaSlashCatalogEntry[];
  /** User-invocable skills this deployment withholds from this chat. */
  readonly deniedSkills: readonly string[];
  /**
   * The entry the user picked in the palette, while the draft still reads as
   * its invocation. A picked identity outranks name resolution: when a skill
   * and a command share a name, the user already answered the only question
   * the router would otherwise have to guess at.
   */
  readonly picked?: string | null;
}

function entryById(
  entries: readonly QaSlashCatalogEntry[],
  id: string | null | undefined,
): QaSlashCatalogEntry | undefined {
  if (id === null || id === undefined) return undefined;
  return entries.find((entry) => entry.id === id);
}

/** Whether a withheld name appears in the text as a native skill gesture. */
const NO_WITHHELD: readonly string[] = Object.freeze([]);

function withheldInText(
  text: string,
  deniedSkills: readonly string[],
): readonly string[] {
  if (deniedSkills.length === 0) return NO_WITHHELD;
  const denied = new Set(deniedSkills);
  return Object.freeze(skillGestures(text).filter((name) => denied.has(name)));
}

export function resolveSlashRoute(input: ResolveSlashRouteInput): QaSlashRoute {
  const line = parseSlashLine(input.text);
  if (line === undefined) {
    // Not a command line. It may still carry a `/name` gesture inside a
    // sentence, which the native skill consumer will act on — say so when the
    // deployment withholds that name.
    const withheld = input.enabled
      ? withheldInText(input.text, input.deniedSkills)
      : Object.freeze([]);
    return withheld.length === 0
      ? { kind: "prompt" }
      : { kind: "prompt", withheld };
  }
  if (!input.enabled) return { kind: "disabled" };
  const picked = entryById(input.entries, input.picked);
  if (picked !== undefined && picked.name === line.name) {
    return picked.kind === "skill"
      ? { kind: "skill", entry: picked }
      : { kind: "command", entry: picked };
  }
  if (!input.catalogReady) return { kind: "unavailable", name: line.name };
  const candidates = input.entries.filter((entry) => entry.name === line.name);
  const only = candidates[0];
  if (only === undefined) return { kind: "unknown", name: line.name };
  if (candidates.length > 1) {
    return { kind: "ambiguous", name: line.name, entries: candidates };
  }
  return only.kind === "skill"
    ? { kind: "skill", entry: only }
    : { kind: "command", entry: only };
}
