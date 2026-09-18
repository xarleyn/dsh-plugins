import type {
  QaSlashCatalogEntry,
  QaSlashCommandSurface,
  QaSlashView,
  ResolvedQaSlashCommands,
} from "../../src/types.js";

/**
 * Slash fixtures for the component and controller suites. The defaults are the
 * ones an untouched deployment runs with: the switch is off, so every test that
 * does not opt in exercises the pre-feature behaviour.
 */

/** The palette policy of an untouched deployment. */
export const DEFAULT_SLASH_POLICY: ResolvedQaSlashCommands["palette"] =
  Object.freeze({
    enabled: true,
    fuzzySearch: true,
    maxVisible: 12,
    showDescriptions: true,
    showKindBadge: true,
  });

/** A catalog with the switch off — what every page shows by default. */
export const DISABLED_SLASH_VIEW: QaSlashView = Object.freeze({
  enabled: false,
  state: "idle",
  entries: Object.freeze([]),
  commandSurface: "unavailable",
  deniedSkills: Object.freeze([]),
  error: null,
  reopen: 0,
});

export function slashView(overrides: Partial<QaSlashView> = {}): QaSlashView {
  return { ...DISABLED_SLASH_VIEW, ...overrides };
}

/** One catalog row; identity is `kind:name`, exactly as the Host sends it. */
export function slashEntry(
  kind: QaSlashCatalogEntry["kind"],
  name: string,
  overrides: Partial<QaSlashCatalogEntry> = {},
): QaSlashCatalogEntry {
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    description: `${name} description`,
    ...overrides,
  };
}

/** A ready catalog over the given rows. */
export function readySlash(
  entries: readonly QaSlashCatalogEntry[],
  overrides: Partial<QaSlashView> = {},
): QaSlashView {
  const surface: QaSlashCommandSurface = entries.some(
    (entry) => entry.kind === "command",
  )
    ? "ready"
    : "unavailable";
  return slashView({
    enabled: true,
    state: "ready",
    entries,
    commandSurface: surface,
    ...overrides,
  });
}
