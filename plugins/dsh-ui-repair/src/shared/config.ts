import type { Volatile } from "@deepseek-ai/cordis";

/**
 * Settings namespace of the browser card. In `0.1.7` the Host derives the
 * namespace from the profile entry id in `cordis.patch.yml`, so this constant is
 * the `ctx.configForms.get()` key and the row id of the same patch.
 */
export const UI_REPAIR_SETTINGS_NAMESPACE = "dsh-ui-repair";

/**
 * The `plugins.row.config` seat the browser card renders into: the Plugins page
 * keys that slot by `` `${package name}#${row id}` ``, so the row half of this
 * key is {@link UI_REPAIR_SETTINGS_NAMESPACE} — the namespace the card writes
 * through stays the same across the move. `scripts/verify-package.mjs` pins both
 * halves against `package.json` and the row `cordis.patch.yml` declares, because
 * the Host gates the row's configure control on this exact key and renaming
 * either half would drop the card off the panel without an error.
 */
export const UI_REPAIR_ROW_CONFIG_KEY = `@yadsh/dsh-ui-repair#${UI_REPAIR_SETTINGS_NAMESPACE}`;

export const REPAIR_MODES = ["observe", "suggest", "auto"] as const;
export type RepairMode = (typeof REPAIR_MODES)[number];

export const REPAIR_RULE_IDS = [
  "R001",
  "R002",
  "R003",
  "R004",
  "R005",
  "R006",
  "R007",
  "R008",
  "R009",
  "R010",
  "R011",
  "R012",
  "R013",
] as const;
export type RepairRuleId = (typeof REPAIR_RULE_IDS)[number];

export interface UIRepairIgnoreRule {
  readonly plugin?: string;
  readonly rule?: RepairRuleId;
  readonly selector?: string;
}

export interface UIRepairPluginConfig {
  readonly enabled?: boolean;
  readonly mode?: RepairMode;
  readonly autoConfidence?: number;
  readonly dangerousConfidence?: number;
  readonly scanOnStartup?: boolean;
  readonly scanAfterMutation?: boolean;
  readonly scanAfterResize?: boolean;
  readonly ignore?: readonly UIRepairIgnoreRule[];
}

/**
 * The profile as the Host hands it to `apply()`: `0.1.7` wraps every `.volatile()`
 * schema node in a live reference, so a field is read with `.get()` per operation
 * instead of once at entry time.
 */
export interface UIRepairVolatileConfig {
  readonly enabled: Volatile<boolean>;
  readonly mode: Volatile<RepairMode>;
  readonly autoConfidence: Volatile<number>;
  readonly dangerousConfidence: Volatile<number>;
  readonly scanOnStartup: Volatile<boolean>;
  readonly scanAfterMutation: Volatile<boolean>;
  readonly scanAfterResize: Volatile<boolean>;
  readonly ignore: Volatile<readonly UIRepairIgnoreRule[]>;
}

export interface ResolvedUIRepairPluginConfig {
  readonly enabled: boolean;
  readonly mode: RepairMode;
  readonly autoConfidence: number;
  readonly dangerousConfidence: number;
  readonly scanOnStartup: boolean;
  readonly scanAfterMutation: boolean;
  readonly scanAfterResize: boolean;
  readonly ignore: readonly UIRepairIgnoreRule[];
}

export const DEFAULT_PLUGIN_CONFIG: ResolvedUIRepairPluginConfig =
  Object.freeze({
    enabled: true,
    mode: "observe",
    autoConfidence: 0.95,
    dangerousConfidence: 0.98,
    scanOnStartup: true,
    scanAfterMutation: true,
    scanAfterResize: true,
    ignore: Object.freeze([]),
  });

function normalizedConfidence(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizedIgnore(
  rules: readonly UIRepairIgnoreRule[] | undefined,
): readonly UIRepairIgnoreRule[] {
  return (rules ?? [])
    .filter(
      (rule) =>
        (rule.plugin?.trim().length ?? 0) > 0 ||
        rule.rule !== undefined ||
        (rule.selector?.trim().length ?? 0) > 0,
    )
    .map((rule) => ({
      ...(rule.plugin === undefined ? {} : { plugin: rule.plugin.trim() }),
      ...(rule.rule === undefined ? {} : { rule: rule.rule }),
      ...(rule.selector === undefined
        ? {}
        : { selector: rule.selector.trim() }),
    }));
}

/**
 * One operation's worth of the live profile: reads every volatile reference once,
 * so a caller that keeps the result is not surprised by a later Host update.
 */
export function resolveVolatileConfig(
  config: UIRepairVolatileConfig,
): ResolvedUIRepairPluginConfig {
  return resolvePluginConfig({
    enabled: config.enabled.get(),
    mode: config.mode.get(),
    autoConfidence: config.autoConfidence.get(),
    dangerousConfidence: config.dangerousConfidence.get(),
    scanOnStartup: config.scanOnStartup.get(),
    scanAfterMutation: config.scanAfterMutation.get(),
    scanAfterResize: config.scanAfterResize.get(),
    ignore: config.ignore.get(),
  });
}

export function resolvePluginConfig(
  config: UIRepairPluginConfig = {},
): ResolvedUIRepairPluginConfig {
  const autoConfidence = normalizedConfidence(
    config.autoConfidence,
    DEFAULT_PLUGIN_CONFIG.autoConfidence,
  );
  const dangerousConfidence = Math.max(
    0.98,
    autoConfidence,
    normalizedConfidence(
      config.dangerousConfidence,
      DEFAULT_PLUGIN_CONFIG.dangerousConfidence,
    ),
  );
  return {
    enabled: config.enabled ?? DEFAULT_PLUGIN_CONFIG.enabled,
    mode: config.mode ?? DEFAULT_PLUGIN_CONFIG.mode,
    autoConfidence,
    dangerousConfidence,
    scanOnStartup: config.scanOnStartup ?? DEFAULT_PLUGIN_CONFIG.scanOnStartup,
    scanAfterMutation:
      config.scanAfterMutation ?? DEFAULT_PLUGIN_CONFIG.scanAfterMutation,
    scanAfterResize:
      config.scanAfterResize ?? DEFAULT_PLUGIN_CONFIG.scanAfterResize,
    ignore: normalizedIgnore(config.ignore),
  };
}
