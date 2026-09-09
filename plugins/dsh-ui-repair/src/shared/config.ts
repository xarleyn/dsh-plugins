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
  readonly ignore?: UIRepairIgnoreRule[];
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

export const DEFAULT_PLUGIN_CONFIG: ResolvedUIRepairPluginConfig = Object.freeze({
  enabled: true,
  mode: "observe",
  autoConfidence: 0.95,
  dangerousConfidence: 0.98,
  scanOnStartup: true,
  scanAfterMutation: true,
  scanAfterResize: true,
  ignore: Object.freeze([]),
});

function normalizedConfidence(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizedIgnore(
  rules: readonly UIRepairIgnoreRule[] | undefined,
): readonly UIRepairIgnoreRule[] {
  return (rules ?? [])
    .filter((rule) =>
      (rule.plugin?.trim().length ?? 0) > 0 ||
      rule.rule !== undefined ||
      (rule.selector?.trim().length ?? 0) > 0,
    )
    .map((rule) => ({
      ...(rule.plugin === undefined ? {} : { plugin: rule.plugin.trim() }),
      ...(rule.rule === undefined ? {} : { rule: rule.rule }),
      ...(rule.selector === undefined ? {} : { selector: rule.selector.trim() }),
    }));
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
