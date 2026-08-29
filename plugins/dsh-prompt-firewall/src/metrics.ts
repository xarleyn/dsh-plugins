import type { PromptAuditResult, PromptFirewallMetricsSnapshot } from './types.js'

export const METRIC_NAMES = Object.freeze({
  requestsTotal: 'dsh_prompt_firewall_requests_total',
  sectionsTotal: 'dsh_prompt_firewall_sections_total',
  sectionsBlockedTotal: 'dsh_prompt_firewall_sections_blocked_total',
  charsRemovedTotal: 'dsh_prompt_firewall_chars_removed_total',
  estimatedTokensRemovedTotal: 'dsh_prompt_firewall_estimated_tokens_removed_total',
} as const)

export type PromptFirewallMetricName = typeof METRIC_NAMES[keyof typeof METRIC_NAMES]

const ZERO_SNAPSHOT: Readonly<PromptFirewallMetricsSnapshot> = Object.freeze({
  requestsTotal: 0,
  sectionsTotal: 0,
  sectionsBlockedTotal: 0,
  charsRemovedTotal: 0,
  estimatedTokensRemovedTotal: 0,
})

/** Backend-neutral, label-free counters suitable for UI or an OTel adapter. */
export class FirewallMetrics {
  private counters: PromptFirewallMetricsSnapshot = { ...ZERO_SNAPSHOT }

  record(result: PromptAuditResult): void {
    this.counters.requestsTotal += 1
    this.counters.sectionsTotal += result.totalSections
    this.counters.sectionsBlockedTotal += result.blockedSections
    this.counters.charsRemovedTotal += result.charsRemoved
    this.counters.estimatedTokensRemovedTotal += result.estimatedTokensRemoved
  }

  snapshot(): PromptFirewallMetricsSnapshot {
    return { ...this.counters }
  }

  namedSnapshot(): Readonly<Record<PromptFirewallMetricName, number>> {
    return Object.freeze({
      [METRIC_NAMES.requestsTotal]: this.counters.requestsTotal,
      [METRIC_NAMES.sectionsTotal]: this.counters.sectionsTotal,
      [METRIC_NAMES.sectionsBlockedTotal]: this.counters.sectionsBlockedTotal,
      [METRIC_NAMES.charsRemovedTotal]: this.counters.charsRemovedTotal,
      [METRIC_NAMES.estimatedTokensRemovedTotal]: this.counters.estimatedTokensRemovedTotal,
    })
  }
}

