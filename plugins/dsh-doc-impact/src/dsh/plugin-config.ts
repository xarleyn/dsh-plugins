import z from "@deepseek-ai/schemastery";
import type { ResolutionMode } from "../config/types.js";
import { ConfigError } from "../config/errors.js";
import {
  DEFAULT_LIMIT_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
} from "../engine/reminder.js";

export interface DocImpactPluginConfig {
  enabled: boolean;
  /** Workspace config path relative to the session cwd (SPEC §8, §37). */
  configFile: string;
  /** Fallback default mode for rules that declare none (SPEC §37). */
  defaultsMode:
    "remind" | "require-review" | "require-resolution" | "require-update";
  safety: { maxReminderRounds: number; onLimit: "allow" | "warn" | "error" };
  maxSnapshotFiles: number;
  debug: boolean;
  /** Master switch of the steering loop; `false` keeps detection without reminders. */
  steer: boolean;
  /** Steering message templates; `{body}` / `{impacts}` carry the generated payload. */
  reminderTemplate: string;
  limitTemplate: string;
}

/**
 * The schema default of every field the settings card edits. The nested groups
 * (`defaults.mode`, `safety.*`, `changeDetection.maxSnapshotFiles`) are listed
 * flat here because that is how the card addresses them.
 */
export const SETTINGS_DEFAULTS: {
  enabled: boolean;
  configFile: string;
  mode: ResolutionMode;
  maxReminderRounds: number;
  onLimit: "allow" | "warn" | "error";
  maxSnapshotFiles: number;
  debug: boolean;
  steer: boolean;
  reminderTemplate: string;
  limitTemplate: string;
} = {
  enabled: true,
  configFile: ".dsh/doc-impact.yml",
  mode: "remind",
  maxReminderRounds: 2,
  onLimit: "allow",
  maxSnapshotFiles: 10_000,
  debug: false,
  steer: true,
  reminderTemplate: DEFAULT_REMINDER_TEMPLATE,
  limitTemplate: DEFAULT_LIMIT_TEMPLATE,
};

const MODES = [
  "remind",
  "require-review",
  "require-resolution",
  "require-update",
] as const;
const ON_LIMIT = ["allow", "warn", "error"] as const;

/**
 * The `Config` of the plugin entry. On `0.1.7` a field is a live form field
 * exactly when its schema node carries `.volatile()`, and the namespace the
 * card edits is the profile entry id rather than a section the plugin installs,
 * so this one schema is both the profile contract (SPEC §37) and the card's
 * document. The three nested groups are marked at the container: volatility
 * inside a nested member is rejected when the schema resolves.
 */
export const ConfigSchema = z.object({
  enabled: z.boolean().default(SETTINGS_DEFAULTS.enabled).volatile(),
  configFile: z
    .string()
    .min(1)
    .default(SETTINGS_DEFAULTS.configFile)
    .volatile(),
  steer: z.boolean().default(SETTINGS_DEFAULTS.steer).volatile(),
  debug: z.boolean().default(SETTINGS_DEFAULTS.debug).volatile(),
  reminderTemplate: z
    .string()
    .min(1)
    .default(SETTINGS_DEFAULTS.reminderTemplate)
    .volatile(),
  limitTemplate: z
    .string()
    .min(1)
    .default(SETTINGS_DEFAULTS.limitTemplate)
    .volatile(),
  defaults: z
    .object({ mode: z.union(MODES).default(SETTINGS_DEFAULTS.mode) })
    .default({ mode: SETTINGS_DEFAULTS.mode })
    .volatile(),
  safety: z
    .object({
      maxReminderRounds: z
        .number()
        .min(1)
        .step(1)
        .default(SETTINGS_DEFAULTS.maxReminderRounds),
      onLimit: z.union(ON_LIMIT).default(SETTINGS_DEFAULTS.onLimit),
    })
    .default({
      maxReminderRounds: SETTINGS_DEFAULTS.maxReminderRounds,
      onLimit: SETTINGS_DEFAULTS.onLimit,
    })
    .volatile(),
  changeDetection: z
    .object({
      maxSnapshotFiles: z
        .number()
        .min(1)
        .step(1)
        .default(SETTINGS_DEFAULTS.maxSnapshotFiles),
    })
    .default({ maxSnapshotFiles: SETTINGS_DEFAULTS.maxSnapshotFiles })
    .volatile(),
});

/** The `Config` as the Host hands it to `apply()`: each editable node a live reference. */
export type DocImpactEntryConfig = ReturnType<typeof ConfigSchema>;
/** The placeholder a steering template must keep to stay usable (SPEC §37). */
const TEMPLATE_REQUIREMENTS: Record<
  "reminderTemplate" | "limitTemplate",
  string
> = { reminderTemplate: "{body}", limitTemplate: "{impacts}" };

/**
 * A template lands in the user layer verbatim; one that dropped its payload
 * placeholder would steer a reminder without the impact list, so it degrades
 * to the default instead.
 */
function templateOr(
  value: unknown,
  field: keyof typeof TEMPLATE_REQUIREMENTS,
): string {
  return typeof value === "string" &&
    value.includes(TEMPLATE_REQUIREMENTS[field])
    ? value
    : SETTINGS_DEFAULTS[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ConfigError(`${label} must be an object`);
  }
  return value;
}

/**
 * Plugin-level configuration (SPEC §37). Strict like first-party dsh plugins:
 * unknown keys fail at activation instead of being ignored silently.
 */
export function resolvePluginConfig(raw: unknown): DocImpactPluginConfig {
  const config = expectRecord(raw, "plugin config");
  const unknown = Object.keys(config).filter(
    (key) =>
      ![
        "enabled",
        "configFile",
        "defaults",
        "safety",
        "changeDetection",
        "debug",
        "steer",
        "reminderTemplate",
        "limitTemplate",
      ].includes(key),
  );
  if (unknown.length > 0) {
    throw new ConfigError(
      `plugin config has unknown key(s): ${unknown.join(", ")}`,
    );
  }

  if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
    throw new ConfigError("enabled must be a boolean");
  }
  if (config.steer !== undefined && typeof config.steer !== "boolean") {
    throw new ConfigError("steer must be a boolean");
  }
  if (
    config.configFile !== undefined &&
    (typeof config.configFile !== "string" || config.configFile.trim() === "")
  ) {
    throw new ConfigError("configFile must be a non-empty string");
  }
  if (config.debug !== undefined && typeof config.debug !== "boolean") {
    throw new ConfigError("debug must be a boolean");
  }
  for (const field of ["reminderTemplate", "limitTemplate"] as const) {
    const value = config[field];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.trim() === "")
    ) {
      throw new ConfigError(`${field} must be a non-empty string`);
    }
  }

  const defaults = expectRecord(config.defaults, "defaults");
  if (
    defaults.mode !== undefined &&
    (typeof defaults.mode !== "string" ||
      !MODES.includes(defaults.mode as never))
  ) {
    throw new ConfigError(`defaults.mode must be one of: ${MODES.join(", ")}`);
  }

  const safety = expectRecord(config.safety, "safety");
  if (
    safety.onLimit !== undefined &&
    (typeof safety.onLimit !== "string" ||
      !ON_LIMIT.includes(safety.onLimit as never))
  ) {
    throw new ConfigError(
      `safety.onLimit must be one of: ${ON_LIMIT.join(", ")}`,
    );
  }
  if (safety.maxReminderRounds !== undefined) {
    const rounds = safety.maxReminderRounds;
    if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1) {
      throw new ConfigError(
        "safety.maxReminderRounds must be a positive integer",
      );
    }
  }

  const changeDetection = expectRecord(
    config.changeDetection,
    "changeDetection",
  );
  let maxSnapshotFiles = SETTINGS_DEFAULTS.maxSnapshotFiles;
  if (changeDetection.maxSnapshotFiles !== undefined) {
    const maxFiles = changeDetection.maxSnapshotFiles;
    if (
      typeof maxFiles !== "number" ||
      !Number.isInteger(maxFiles) ||
      maxFiles < 1
    ) {
      throw new ConfigError(
        "changeDetection.maxSnapshotFiles must be a positive integer",
      );
    }
    maxSnapshotFiles = maxFiles;
  }

  return {
    enabled: config.enabled ?? SETTINGS_DEFAULTS.enabled,
    configFile: config.configFile ?? SETTINGS_DEFAULTS.configFile,
    defaultsMode:
      (defaults.mode as DocImpactPluginConfig["defaultsMode"]) ??
      SETTINGS_DEFAULTS.mode,
    safety: {
      maxReminderRounds:
        (safety.maxReminderRounds as number) ??
        SETTINGS_DEFAULTS.maxReminderRounds,
      onLimit:
        (safety.onLimit as DocImpactPluginConfig["safety"]["onLimit"]) ??
        SETTINGS_DEFAULTS.onLimit,
    },
    maxSnapshotFiles,
    debug: config.debug ?? SETTINGS_DEFAULTS.debug,
    steer: config.steer ?? SETTINGS_DEFAULTS.steer,
    reminderTemplate:
      (config.reminderTemplate as string | undefined) ??
      SETTINGS_DEFAULTS.reminderTemplate,
    limitTemplate:
      (config.limitTemplate as string | undefined) ??
      SETTINGS_DEFAULTS.limitTemplate,
  };
}

/** One config node read through its live reference, or as it stands. */
function deref(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  const candidate = node as { get?: unknown };
  return typeof candidate.get === "function"
    ? (candidate as { get: () => unknown }).get()
    : node;
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : value === true;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * The entry config as plain nested data, in the shape a profile patch row
 * declares (SPEC §37). A volatile node is a stable reference whose value moves,
 * so every read goes through here first and the validators below keep seeing
 * plain data.
 *
 * Keys this plugin does not know are carried across untouched rather than
 * dropped: {@link resolvePluginConfig} is what makes a typo fail at activation
 * instead of being ignored silently, and it can only name a key it can see.
 */
export function plainEntryConfig(
  config?: DocImpactEntryConfig | Record<string, unknown>,
): Record<string, unknown> {
  const root = recordOf(deref(config));
  const defaults = recordOf(deref(root.defaults));
  const safety = recordOf(deref(root.safety));
  const changeDetection = recordOf(deref(root.changeDetection));
  const plain: Record<string, unknown> = {
    enabled: deref(root.enabled),
    configFile: deref(root.configFile),
    steer: deref(root.steer),
    debug: deref(root.debug),
    reminderTemplate: deref(root.reminderTemplate),
    limitTemplate: deref(root.limitTemplate),
    defaults: { mode: deref(defaults.mode) },
    safety: {
      maxReminderRounds: deref(safety.maxReminderRounds),
      onLimit: deref(safety.onLimit),
    },
    changeDetection: {
      maxSnapshotFiles: deref(changeDetection.maxSnapshotFiles),
    },
  };
  for (const key of Object.keys(root)) {
    if (!(key in plain)) plain[key] = root[key];
  }
  return plain;
}

function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : fallback;
}

/**
 * One plain snapshot of the live entry config (schema defaults → composition
 * base → user layer, already folded by the Host). Taken per operation rather
 * than once at startup: the references are stable while their values move, so a
 * resolver that captured them at apply() time would freeze the document. Every
 * field degrades rather than crashes — a value an older schema wrote must not
 * break an agent turn.
 */
export function readLiveConfig(
  config?: DocImpactEntryConfig | Record<string, unknown>,
): DocImpactPluginConfig {
  const s = plainEntryConfig(config);
  const defaults = recordOf(s.defaults);
  const safety = recordOf(s.safety);
  const changeDetection = recordOf(s.changeDetection);
  return {
    enabled: boolOr(s.enabled, SETTINGS_DEFAULTS.enabled),
    configFile: textOr(s.configFile, SETTINGS_DEFAULTS.configFile),
    defaultsMode: enumOf(defaults.mode, MODES, SETTINGS_DEFAULTS.mode),
    safety: {
      maxReminderRounds: positiveInt(
        safety.maxReminderRounds,
        SETTINGS_DEFAULTS.maxReminderRounds,
      ),
      onLimit: enumOf(safety.onLimit, ON_LIMIT, SETTINGS_DEFAULTS.onLimit),
    },
    maxSnapshotFiles: positiveInt(
      changeDetection.maxSnapshotFiles,
      SETTINGS_DEFAULTS.maxSnapshotFiles,
    ),
    debug: boolOr(s.debug, SETTINGS_DEFAULTS.debug),
    steer: boolOr(s.steer, SETTINGS_DEFAULTS.steer),
    reminderTemplate: templateOr(s.reminderTemplate, "reminderTemplate"),
    limitTemplate: templateOr(s.limitTemplate, "limitTemplate"),
  };
}
