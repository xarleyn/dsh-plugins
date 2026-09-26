import type { Volatile } from "@deepseek-ai/cordis";
import type {
  AssembledSection,
  PromptAssembly,
} from "@deepseek-ai/dsh-system-prompt";

export type FirewallMode = "off" | "audit" | "blocklist" | "allowlist";
export type FirewallPreset = "clean" | "strict" | "audit-only";
export type UnknownPluginPolicy = "allow" | "block";

export interface AuditConfig {
  enabled: boolean;
  logAllowed: boolean;
  logBlocked: boolean;
  includePreview: boolean;
  previewChars: number;
  historySize: number;
  highlightNewSections: boolean;
}

export interface MetricsConfig {
  enabled: boolean;
}

/**
 * User-facing configuration. A volatile reference holds `undefined` for a field
 * the deployment never set, so an absent value and an absent key mean the same
 * thing here.
 */
export interface PromptFirewallConfig {
  enabled?: boolean | undefined;
  mode?: FirewallMode | undefined;
  preset?: FirewallPreset | undefined;
  blockedSections?: readonly string[] | undefined;
  allowedSections?: readonly string[] | undefined;
  blockedPrefixes?: readonly string[] | undefined;
  allowedPrefixes?: readonly string[] | undefined;
  blockedPatterns?: readonly string[] | undefined;
  allowedPatterns?: readonly string[] | undefined;
  protectedSections?: readonly string[] | undefined;
  protectCoreSections?: boolean | undefined;
  unknownPluginPolicy?: UnknownPluginPolicy | undefined;
  audit?: Partial<AuditConfig> | undefined;
  metrics?: Partial<MetricsConfig> | undefined;
}

/**
 * Cordis entry config. Every field the Host can edit while the plugin runs is
 * a volatile reference, so a value is read from it per operation rather than
 * captured once at startup.
 */
export interface PromptFirewallVolatileConfig {
  enabled?: Volatile<boolean>;
  /** Preset-owned fields carry no schema default, so their snapshot may be absent. */
  mode?: Volatile<FirewallMode | undefined>;
  preset?: Volatile<FirewallPreset | undefined>;
  blockedSections?: Volatile<string[]>;
  allowedSections?: Volatile<string[]>;
  blockedPrefixes?: Volatile<string[]>;
  allowedPrefixes?: Volatile<string[]>;
  blockedPatterns?: Volatile<string[]>;
  allowedPatterns?: Volatile<string[]>;
  protectedSections?: Volatile<string[]>;
  protectCoreSections?: Volatile<boolean>;
  unknownPluginPolicy?: Volatile<UnknownPluginPolicy | undefined>;
  audit?: Volatile<Partial<AuditConfig>>;
  metrics?: Volatile<Partial<MetricsConfig>>;
}

/** Fully materialized, immutable runtime configuration. */
export interface ResolvedPromptFirewallConfig {
  readonly enabled: boolean;
  readonly mode: FirewallMode;
  readonly preset?: FirewallPreset;
  readonly blockedSections: readonly string[];
  readonly allowedSections: readonly string[];
  readonly blockedPrefixes: readonly string[];
  readonly allowedPrefixes: readonly string[];
  readonly blockedPatterns: readonly string[];
  readonly allowedPatterns: readonly string[];
  readonly protectedSections: readonly string[];
  readonly protectCoreSections: boolean;
  readonly unknownPluginPolicy: UnknownPluginPolicy;
  readonly audit: Readonly<AuditConfig>;
  readonly metrics: Readonly<MetricsConfig>;
}

export type FirewallAction = "allow" | "block" | "protect";
export type SectionPolicy = FirewallAction | "clear";

export interface FirewallDecision {
  action: FirewallAction;
  reason: string;
  rule?: string;
}

export interface PromptSectionAudit {
  name: string;
  decision: "allowed" | "blocked" | "protected";
  reason: string;
  chars: number;
  estimatedTokens: number;
  preview?: string;
  suspicious?: boolean;
  isNew?: boolean;
}

export interface PromptAuditResult {
  timestamp: number;
  totalSections: number;
  allowedSections: number;
  blockedSections: number;
  charsBefore: number;
  charsAfter: number;
  charsRemoved: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedTokensRemoved: number;
  sections: PromptSectionAudit[];
  bypassed?: boolean;
  bypassReason?: string;
}

export interface KnownSection {
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  observations: number;
}

export interface PromptFirewallService {
  inspect(): PromptFirewallInspectorSnapshot;
  inspectLast(): PromptAuditResult | null;
  inspectHistory(): PromptAuditResult[];
  getKnownSections(): KnownSection[];
  getMetrics(): PromptFirewallMetricsSnapshot;
  getConfig(): ResolvedPromptFirewallConfig;
  evaluateSection(section: AssembledSection): FirewallDecision;
  setSectionPolicy(
    name: string,
    policy: SectionPolicy,
    expectedRevision?: number,
  ): Promise<void>;
}

/** JSON-safe state exposed to the browser Prompt Inspector. */
export interface PromptFirewallInspectorSnapshot {
  config: ResolvedPromptFirewallConfig;
  last: PromptAuditResult | null;
  knownSections: KnownSection[];
  metrics: PromptFirewallMetricsSnapshot;
}

export interface PromptFirewallMetricsSnapshot {
  requestsTotal: number;
  sectionsTotal: number;
  sectionsBlockedTotal: number;
  charsRemovedTotal: number;
  estimatedTokensRemovedTotal: number;
}

export interface FirewallLogger {
  info(message: string): unknown;
  warn(message: string): unknown;
  error(message: string): unknown;
}

/** Upstream currently strips `complete` before the waterfall; kept for compatible hosts. */
export type FirewallSection = AssembledSection & { complete?: boolean };
export type FirewallAssembly = PromptAssembly & { sections: FirewallSection[] };
