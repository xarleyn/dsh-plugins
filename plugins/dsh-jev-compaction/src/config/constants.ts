/**
 * Fixed vocabulary of the plugin configuration: the shipped System One endpoint
 * presets, the tool names shaped by default, and the literal unions the schema,
 * the resolver and the sibling config modules are written against. A type
 * derived from one of these tuples stays next to that tuple, so the two cannot
 * drift apart.
 *
 * Field semantics follow the plugin SPEC §18, §22, §24.
 */

/** Endpoint presets shipped with the plugin (SPEC §18, §26.3). */
export const SYSTEM_ONE_PRESETS = {
  typesafe: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    apiKeyEnv: "TYPESAFE_API_KEY",
    model: "jev-latest",
  },
  jeff: {
    // The System One route, exactly as the typesafe preset spells it: the
    // client POSTs to this URL as it stands, so a bare host would answer 404.
    baseUrl: "http://localhost:8000/v1/systemone",
    apiKeyEnv: "JEFF_API_KEY",
    model: "jev-latest",
  },
  custom: {
    baseUrl: "",
    apiKeyEnv: "",
    model: "jev-latest",
  },
} as const;

export type SystemOneProvider = keyof typeof SYSTEM_ONE_PRESETS;
export const SYSTEM_ONE_PROVIDERS: readonly SystemOneProvider[] = [
  "typesafe",
  "jeff",
  "custom",
];

/**
 * Tools shaped by default (SPEC §11.1 of the result-shaping SPEC). Only
 * command-like tools whose output is bulk, line-oriented and cheaply
 * reproducible: everything else — file reads, diffs, searches, structured
 * business tools, subagent results — may carry unique evidence that cannot be
 * recovered from output shape alone.
 */
export const DEFAULT_SHAPE_TOOLS: readonly string[] = Object.freeze([
  "bash",
  "terminal",
  "pwsh",
  "run_command",
  "execute_command",
  "run_tests",
]);

/** Result-shaping category of one collapsed run (SPEC §18). */
export const SHAPING_KINDS = [
  "routine_progress",
  "summary",
  "warning",
  "failure",
  "important_evidence",
  "unknown",
] as const;

export type ShapingKind = (typeof SHAPING_KINDS)[number];

/** Archive failure policy (SPEC §24). */
export const ARCHIVE_FAILURE_POLICIES = [
  "keep-original",
  "shape-anyway",
] as const;

export type ArchiveFailurePolicy = (typeof ARCHIVE_FAILURE_POLICIES)[number];
