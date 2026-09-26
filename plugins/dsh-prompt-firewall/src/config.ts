import z from "@deepseek-ai/schemastery";
import { getPreset } from "./presets.js";
import type {
  AuditConfig,
  FirewallMode,
  FirewallPreset,
  MetricsConfig,
  PromptFirewallConfig,
  PromptFirewallVolatileConfig,
  ResolvedPromptFirewallConfig,
  UnknownPluginPolicy,
} from "./types.js";

export const DEFAULT_AUDIT_CONFIG: Readonly<AuditConfig> = Object.freeze({
  enabled: true,
  logAllowed: false,
  logBlocked: true,
  includePreview: false,
  previewChars: 160,
  historySize: 100,
  highlightNewSections: true,
});

export const DEFAULT_METRICS_CONFIG: Readonly<MetricsConfig> = Object.freeze({
  enabled: true,
});

export const DEFAULT_CONFIG: ResolvedPromptFirewallConfig = Object.freeze({
  enabled: true,
  mode: "blocklist",
  blockedSections: Object.freeze([]),
  allowedSections: Object.freeze([]),
  blockedPrefixes: Object.freeze([]),
  allowedPrefixes: Object.freeze([]),
  blockedPatterns: Object.freeze([]),
  allowedPatterns: Object.freeze([]),
  protectedSections: Object.freeze([]),
  protectCoreSections: true,
  unknownPluginPolicy: "allow",
  audit: DEFAULT_AUDIT_CONFIG,
  metrics: DEFAULT_METRICS_CONFIG,
});

const nonEmptyString = z.string().min(1);
const stringList = z.array(nonEmptyString);

/** Runtime schema consumed by the Cordis loader. */
export const ConfigSchema = z.object({
  enabled: z.boolean().default(true).volatile(),
  // Keep preset-owned fields absent until resolveConfig(). Applying schema
  // defaults here would make `preset: strict` look explicitly overridden.
  mode: z.union(["off", "audit", "blocklist", "allowlist"] as const).volatile(),
  preset: z.union(["clean", "strict", "audit-only"] as const).volatile(),
  blockedSections: stringList.default([]).volatile(),
  allowedSections: stringList.default([]).volatile(),
  blockedPrefixes: stringList.default([]).volatile(),
  allowedPrefixes: stringList.default([]).volatile(),
  blockedPatterns: stringList.default([]).volatile(),
  allowedPatterns: stringList.default([]).volatile(),
  protectedSections: stringList.default([]).volatile(),
  protectCoreSections: z.boolean().default(true).volatile(),
  unknownPluginPolicy: z.union(["allow", "block"] as const).volatile(),
  audit: z
    .object({
      enabled: z.boolean().default(true),
      logAllowed: z.boolean().default(false),
      logBlocked: z.boolean().default(true),
      includePreview: z.boolean().default(false),
      previewChars: z.number().step(1).min(0).default(160),
      historySize: z.number().step(1).min(0).default(100),
      highlightNewSections: z.boolean().default(true),
    })
    .default(DEFAULT_AUDIT_CONFIG as AuditConfig)
    .volatile(),
  metrics: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default(DEFAULT_METRICS_CONFIG as MetricsConfig)
    .volatile(),
});

/**
 * Take one consistent view of the entry config by reading every volatile
 * reference once. Callers take a snapshot per operation: a value captured at
 * plugin start would outlive the Host editing it.
 */
export function readVolatileConfig(
  config: PromptFirewallVolatileConfig,
): PromptFirewallConfig {
  return {
    enabled: config.enabled?.get(),
    mode: config.mode?.get(),
    preset: config.preset?.get(),
    blockedSections: config.blockedSections?.get(),
    allowedSections: config.allowedSections?.get(),
    blockedPrefixes: config.blockedPrefixes?.get(),
    allowedPrefixes: config.allowedPrefixes?.get(),
    blockedPatterns: config.blockedPatterns?.get(),
    allowedPatterns: config.allowedPatterns?.get(),
    protectedSections: config.protectedSections?.get(),
    protectCoreSections: config.protectCoreSections?.get(),
    unknownPluginPolicy: config.unknownPluginPolicy?.get(),
    audit: config.audit?.get(),
    metrics: config.metrics?.get(),
  };
}

function mergeList(
  preset: readonly string[] | undefined,
  configured: readonly string[] | undefined,
): readonly string[] {
  const result = [...new Set([...(preset ?? []), ...(configured ?? [])])];
  if (result.some((value) => value.length === 0)) {
    throw new TypeError("firewall rules must not contain empty strings");
  }
  return Object.freeze(result);
}

export function resolveConfig(
  config: PromptFirewallConfig = {},
): ResolvedPromptFirewallConfig {
  const preset = getPreset(config.preset);
  const resolved = {
    enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
    mode: (config.mode ?? preset.mode ?? DEFAULT_CONFIG.mode) as FirewallMode,
    ...(config.preset === undefined
      ? {}
      : { preset: config.preset as FirewallPreset }),
    blockedSections: mergeList(preset.blockedSections, config.blockedSections),
    allowedSections: mergeList(preset.allowedSections, config.allowedSections),
    blockedPrefixes: mergeList(preset.blockedPrefixes, config.blockedPrefixes),
    allowedPrefixes: mergeList(preset.allowedPrefixes, config.allowedPrefixes),
    blockedPatterns: mergeList(preset.blockedPatterns, config.blockedPatterns),
    allowedPatterns: mergeList(preset.allowedPatterns, config.allowedPatterns),
    protectedSections: mergeList(
      preset.protectedSections,
      config.protectedSections,
    ),
    protectCoreSections:
      config.protectCoreSections ??
      preset.protectCoreSections ??
      DEFAULT_CONFIG.protectCoreSections,
    unknownPluginPolicy: (config.unknownPluginPolicy ??
      preset.unknownPluginPolicy ??
      DEFAULT_CONFIG.unknownPluginPolicy) as UnknownPluginPolicy,
    audit: Object.freeze({
      ...DEFAULT_AUDIT_CONFIG,
      ...preset.audit,
      ...config.audit,
    }),
    metrics: Object.freeze({
      ...DEFAULT_METRICS_CONFIG,
      ...preset.metrics,
      ...config.metrics,
    }),
  } satisfies ResolvedPromptFirewallConfig;

  return Object.freeze(resolved);
}
