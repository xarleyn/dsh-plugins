import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { applyFirewall } from '../src/firewall.js'
import { FirewallMetrics, METRIC_NAMES } from '../src/metrics.js'

function assembly(sections: Array<{ name: string, text: string }>): PromptAssembly {
  return { sections, contexts: [], tools: [], variables: {} }
}

describe('FirewallMetrics', () => {
  it('accumulates only aggregate, label-free counters', () => {
    const metrics = new FirewallMetrics()
    const config = resolveConfig({ blockedSections: ['plugin:noisy'] })

    applyFirewall(assembly([
      { name: 'plugin:clean', text: '12345678' },
      { name: 'plugin:noisy', text: '1234' },
    ]), { config, metrics })
    applyFirewall(assembly([
      { name: 'plugin:clean', text: '12345678' },
    ]), { config, metrics })

    expect(metrics.snapshot()).toEqual({
      requestsTotal: 2,
      sectionsTotal: 3,
      sectionsBlockedTotal: 1,
      charsRemovedTotal: 4,
      estimatedTokensRemovedTotal: 1,
    })
    expect(metrics.namedSnapshot()).toEqual({
      [METRIC_NAMES.requestsTotal]: 2,
      [METRIC_NAMES.sectionsTotal]: 3,
      [METRIC_NAMES.sectionsBlockedTotal]: 1,
      [METRIC_NAMES.charsRemovedTotal]: 4,
      [METRIC_NAMES.estimatedTokensRemovedTotal]: 1,
    })
  })

  it('does not collect when metrics are disabled', () => {
    const metrics = new FirewallMetrics()
    applyFirewall(assembly([{ name: 'plugin:noisy', text: '1234' }]), {
      config: resolveConfig({
        blockedSections: ['plugin:noisy'],
        metrics: { enabled: false },
      }),
      metrics,
    })
    expect(metrics.snapshot().requestsTotal).toBe(0)
  })
})

