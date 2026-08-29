import type { AssembledSection, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

export type FirewallMode = 'off' | 'audit' | 'blocklist' | 'allowlist'
export type FirewallPreset = 'clean' | 'strict' | 'audit-only'
export type UnknownPluginPolicy = 'allow' | 'block'

export interface AuditConfig {
  enabled: boolean
  logAllowed: boolean
  logBlocked: boolean
  includePreview: boolean
  previewChars: number
  historySize: number
  highlightNewSections: boolean
}

export interface MetricsConfig {
  enabled: boolean
}

/** User-facing configuration. Every field is optional at the Cordis boundary. */
export interface PromptFirewallConfig {
  enabled?: boolean
  mode?: FirewallMode
  preset?: FirewallPreset
  blockedSections?: string[]
  allowedSections?: string[]
  blockedPrefixes?: string[]
  allowedPrefixes?: string[]
  blockedPatterns?: string[]
  allowedPatterns?: string[]
  protectedSections?: string[]
  protectCoreSections?: boolean
  unknownPluginPolicy?: UnknownPluginPolicy
  audit?: Partial<AuditConfig>
  metrics?: Partial<MetricsConfig>
}

/** Fully materialized, immutable runtime configuration. */
export interface ResolvedPromptFirewallConfig {
  readonly enabled: boolean
  readonly mode: FirewallMode
  readonly preset?: FirewallPreset
  readonly blockedSections: readonly string[]
  readonly allowedSections: readonly string[]
  readonly blockedPrefixes: readonly string[]
  readonly allowedPrefixes: readonly string[]
  readonly blockedPatterns: readonly string[]
  readonly allowedPatterns: readonly string[]
  readonly protectedSections: readonly string[]
  readonly protectCoreSections: boolean
  readonly unknownPluginPolicy: UnknownPluginPolicy
  readonly audit: Readonly<AuditConfig>
  readonly metrics: Readonly<MetricsConfig>
}

export type FirewallAction = 'allow' | 'block' | 'protect'
export type SectionPolicy = FirewallAction | 'clear'

export interface FirewallDecision {
  action: FirewallAction
  reason: string
  rule?: string
}

export interface PromptSectionAudit {
  name: string
  decision: 'allowed' | 'blocked' | 'protected'
  reason: string
  chars: number
  estimatedTokens: number
  preview?: string
  suspicious?: boolean
  isNew?: boolean
}

export interface PromptAuditResult {
  timestamp: number
  totalSections: number
  allowedSections: number
  blockedSections: number
  charsBefore: number
  charsAfter: number
  charsRemoved: number
  estimatedTokensBefore: number
  estimatedTokensAfter: number
  estimatedTokensRemoved: number
  sections: PromptSectionAudit[]
  bypassed?: boolean
  bypassReason?: string
}

export interface KnownSection {
  name: string
  firstSeenAt: number
  lastSeenAt: number
  observations: number
}

export interface PromptFirewallService {
  inspect(): PromptFirewallInspectorSnapshot
  inspectLast(): PromptAuditResult | null
  inspectHistory(): PromptAuditResult[]
  getKnownSections(): KnownSection[]
  getMetrics(): PromptFirewallMetricsSnapshot
  getConfig(): ResolvedPromptFirewallConfig
  evaluateSection(section: AssembledSection): FirewallDecision
  setSectionPolicy(name: string, policy: SectionPolicy, expectedRevision?: number): Promise<void>
  reloadRules(): void
}

/** JSON-safe state exposed to the browser Prompt Inspector. */
export interface PromptFirewallInspectorSnapshot {
  config: ResolvedPromptFirewallConfig
  last: PromptAuditResult | null
  knownSections: KnownSection[]
  metrics: PromptFirewallMetricsSnapshot
}

export interface PromptFirewallMetricsSnapshot {
  requestsTotal: number
  sectionsTotal: number
  sectionsBlockedTotal: number
  charsRemovedTotal: number
  estimatedTokensRemovedTotal: number
}

export interface FirewallLogger {
  info(message: string): unknown
  warn(message: string): unknown
  error(message: string): unknown
}

/** Upstream currently strips `complete` before the waterfall; kept for compatible hosts. */
export type FirewallSection = AssembledSection & { complete?: boolean }
export type FirewallAssembly = PromptAssembly & { sections: FirewallSection[] }
