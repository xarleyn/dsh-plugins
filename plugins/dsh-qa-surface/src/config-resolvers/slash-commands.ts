import type {
  QaSlashCommandsConfig,
  QaSurfaceConfig,
  ResolvedQaSlashCommands,
} from "../types.js";
import { DEFAULT_QA_SURFACE_CONFIG } from "./defaults.js";
import { isQaSlashPolicyMode, normalizeSlashAllow } from "../slash/policy.js";

/** Palette ceilings; a palette longer than the viewport is unusable on mobile. */
export const QA_SLASH_MAX_VISIBLE_MIN = 1;
export const QA_SLASH_MAX_VISIBLE_MAX = 100;

const DEFAULT_SLASH = DEFAULT_QA_SURFACE_CONFIG.slashCommands;

function resolvePolicy(
  input: QaSlashCommandsConfig["skills"] | undefined,
  fallback: QaSlashCommandsConfig["skills"],
  label: string,
): {
  readonly mode: ResolvedQaSlashCommands["skills"]["mode"];
  readonly allow: readonly string[];
} {
  const mode = input?.mode ?? fallback?.mode ?? "deny-all";
  if (!isQaSlashPolicyMode(mode)) {
    throw new TypeError(
      `dsh-qa-surface: ${label}.mode must be deny-all, allow-list or all`,
    );
  }
  return {
    mode,
    allow: normalizeSlashAllow(input?.allow ?? [], label),
  };
}

/**
 * Resolve the slash interface policy.
 *
 * The master switch lives in lockdown, so it arrives as a neighbor rather than
 * being re-read here — one owner per decision. Two consequences are deliberate:
 *
 * - An upgrade from a deployment that had already set
 *   `lockdown.allowSlashCommands: true` but knows nothing about this section
 *   keeps working: skills fall back to `all` (every user-invocable skill the
 *   session already exposed) and commands stay denied. The flag is reported as
 *   `legacyDefaults` so the Host can say so once, out loud.
 * - A deployment that declares the section and leaves the switch off changes
 *   nothing at all: the resolved policy is inert until the switch is on.
 */
export function resolveSlashCommands(
  input: QaSurfaceConfig,
  allowSlashCommands: boolean,
): ResolvedQaSlashCommands {
  const declared = input.slashCommands;
  const legacyDefaults = allowSlashCommands && declared === undefined;
  const palette = declared?.palette;
  const maxVisible = palette?.maxVisible ?? DEFAULT_SLASH.palette.maxVisible;
  if (
    !Number.isInteger(maxVisible) ||
    maxVisible < QA_SLASH_MAX_VISIBLE_MIN ||
    maxVisible > QA_SLASH_MAX_VISIBLE_MAX
  ) {
    throw new TypeError(
      `dsh-qa-surface: slashCommands.palette.maxVisible must be an integer between ${String(QA_SLASH_MAX_VISIBLE_MIN)} and ${String(QA_SLASH_MAX_VISIBLE_MAX)}`,
    );
  }
  const skills = resolvePolicy(
    declared?.skills,
    // Legacy compatibility: the section's absence widens skills, never
    // commands, so an upgrade cannot hand the user a control-plane command.
    legacyDefaults ? { mode: "all", allow: [] } : DEFAULT_SLASH.skills,
    "slashCommands.skills",
  );
  const commands = resolvePolicy(
    declared?.commands,
    DEFAULT_SLASH.commands,
    "slashCommands.commands",
  );
  return Object.freeze({
    enabled: allowSlashCommands,
    skills: Object.freeze(skills),
    commands: Object.freeze(commands),
    palette: Object.freeze({
      enabled: palette?.enabled ?? DEFAULT_SLASH.palette.enabled,
      fuzzySearch: palette?.fuzzySearch ?? DEFAULT_SLASH.palette.fuzzySearch,
      maxVisible,
      showDescriptions:
        palette?.showDescriptions ?? DEFAULT_SLASH.palette.showDescriptions,
      showKindBadge:
        palette?.showKindBadge ?? DEFAULT_SLASH.palette.showKindBadge,
    }),
    legacyDefaults,
  });
}
