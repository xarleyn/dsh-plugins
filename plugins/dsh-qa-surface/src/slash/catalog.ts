/**
 * The unified presentation model behind the palette.
 *
 * Two native catalogs arrive here — the session's user-invocable skills and
 * the session agent's effective commands — and leave as one list of entries
 * whose identity is `skill:<name>` / `command:<name>`. The prefix is the whole
 * point: both registries may publish a `plan`, and a palette that keyed rows
 * by bare name would let one of them silently replace the other.
 *
 * Pure on purpose. Nothing here reads a session, a service or a file: the host
 * remote gathers the native inputs, this module decides what the palette sees,
 * and the tests drive it with plain arrays.
 */

import type { QaSlashCatalogEntry, QaSlashCommandSurface } from "../types.js";
import {
  filterBySlashPolicy,
  intersectSlashNames,
  type QaSlashPolicy,
} from "./policy.js";

export const QA_SLASH_SKILL_PREFIX = "skill:";
export const QA_SLASH_COMMAND_PREFIX = "command:";

/** One user-invocable skill, as the skills registry published it. */
export interface QaSlashNativeSkill {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  /** Whether the model is also offered this skill. */
  readonly modelInvocable?: boolean;
}

/** One effective command descriptor, as the command registry published it. */
export interface QaSlashNativeCommand {
  readonly name: string;
  readonly description: string;
  readonly inputHint?: string;
  readonly acceptsAttachments?: boolean;
}

export interface BuildSlashCatalogOptions {
  readonly skills: readonly QaSlashNativeSkill[];
  readonly commands: readonly QaSlashNativeCommand[];
  readonly skillPolicy: QaSlashPolicy;
  readonly commandPolicy: QaSlashPolicy;
  /**
   * The session role's own user-skill grant, when the access system is on.
   * `undefined` means the role system has no opinion, which is its state on a
   * deployment that never enabled roles — not "grant nothing".
   */
  readonly grantedSkills?: readonly string[] | undefined;
  readonly commandSurface: QaSlashCommandSurface;
  /** Native entries arrive alphabetically; this makes the order explicit. */
  readonly localeCompare?: (left: string, right: string) => number;
}

/** The routing identity of one native name; never the bare name. */
export function slashEntryId(
  kind: QaSlashCatalogEntry["kind"],
  name: string,
): string {
  const prefix =
    kind === "skill" ? QA_SLASH_SKILL_PREFIX : QA_SLASH_COMMAND_PREFIX;
  return `${prefix}${name}`;
}

function skillEntries(
  skills: readonly QaSlashNativeSkill[],
): QaSlashCatalogEntry[] {
  return skills.map((skill) =>
    Object.freeze({
      id: slashEntryId("skill", skill.name),
      kind: "skill" as const,
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined || skill.whenToUse === ""
        ? {}
        : { whenToUse: skill.whenToUse }),
      ...(skill.modelInvocable === undefined
        ? {}
        : { modelInvocable: skill.modelInvocable }),
    }),
  );
}

function commandEntries(
  commands: readonly QaSlashNativeCommand[],
): QaSlashCatalogEntry[] {
  return commands.map((command) =>
    Object.freeze({
      id: slashEntryId("command", command.name),
      kind: "command" as const,
      name: command.name,
      description: command.description,
      ...(command.inputHint === undefined || command.inputHint === ""
        ? {}
        : { inputHint: command.inputHint }),
      ...(command.acceptsAttachments === undefined
        ? {}
        : { acceptsAttachments: command.acceptsAttachments }),
    }),
  );
}

function byName(
  left: QaSlashCatalogEntry,
  right: QaSlashCatalogEntry,
  compare: (left: string, right: string) => number,
): number {
  return compare(left.name, right.name);
}

/**
 * Build the palette the browser is allowed to show. Skills lead, commands
 * follow: the two kinds stay contiguous so the palette can group them without
 * re-sorting, and a name collision keeps both rows.
 */
export function buildSlashCatalog(
  options: BuildSlashCatalogOptions,
): readonly QaSlashCatalogEntry[] {
  const compare =
    options.localeCompare ?? ((left, right) => left.localeCompare(right));
  const skills = intersectSlashNames(
    filterBySlashPolicy(options.skills, options.skillPolicy),
    options.grantedSkills,
  );
  const commands =
    options.commandSurface === "ready"
      ? filterBySlashPolicy(options.commands, options.commandPolicy)
      : [];
  const merged = [
    ...skillEntries(skills).sort((left, right) => byName(left, right, compare)),
    ...commandEntries(commands).sort((left, right) =>
      byName(left, right, compare),
    ),
  ];
  // Identity is the routing key, so a registry that somehow repeats a name
  // must not produce two rows the browser cannot tell apart.
  const unique = new Map<string, QaSlashCatalogEntry>();
  for (const entry of merged) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return Object.freeze([...unique.values()]);
}
