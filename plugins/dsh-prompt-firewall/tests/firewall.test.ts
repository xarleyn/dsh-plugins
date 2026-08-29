import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import { AuditStore } from '../src/audit.js'
import { resolveConfig } from '../src/config.js'
import { applyFirewall } from '../src/firewall.js'

function assembly(sections: Array<{ name: string, text: string, complete?: boolean }>): PromptAssembly {
  return {
    sections,
    contexts: [{ name: 'runtime', text: 'context' }],
    tools: [],
    variables: { cwd: '/workspace' },
  }
}

describe('applyFirewall', () => {
  it('removes only blocked sections and preserves every allowed value by reference', () => {
    const allowed = { name: 'plugin:clean', text: 'functional guidance' }
    const blocked = { name: 'plugin:noisy', text: 'advertisement' }
    const original = assembly([allowed, blocked])
    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ['plugin:noisy'] }),
    })

    expect(result).not.toBe(original)
    expect(result.sections).toEqual([allowed])
    expect(result.sections[0]).toBe(allowed)
    expect(result.contexts).toBe(original.contexts)
    expect(result.tools).toBe(original.tools)
    expect(result.variables).toBe(original.variables)
  })

  it('returns the exact assembly in audit mode and records estimates without previews', () => {
    const original = assembly([{ name: 'plugin:noisy', text: '12345678' }])
    const config = resolveConfig({
      mode: 'audit',
      blockedSections: ['plugin:noisy'],
      audit: { includePreview: false },
    })
    const store = new AuditStore(100, true)
    const result = applyFirewall(original, { config, auditStore: store })

    expect(result).toBe(original)
    expect(store.last()).toMatchObject({
      totalSections: 1,
      blockedSections: 0,
      charsBefore: 8,
      estimatedTokensBefore: 2,
      sections: [{ name: 'plugin:noisy', decision: 'allowed', reason: 'mode-audit' }],
    })
    expect(store.last()?.sections[0]).not.toHaveProperty('preview')
  })

  it('logs preview only when explicitly enabled', () => {
    const warn = vi.fn()
    applyFirewall(assembly([{ name: 'plugin:noisy', text: 'sensitive value' }]), {
      config: resolveConfig({
        blockedSections: ['plugin:noisy'],
        audit: { includePreview: true, previewChars: 9 },
      }),
      logger: { info: vi.fn(), warn, error: vi.fn() },
    })
    expect(warn.mock.calls[0]?.[0]).toContain('preview="sensitive"')
  })

  it('fails open and logs an internal evaluator error', () => {
    const original = assembly([{ name: 'plugin:noisy', text: 'text' }])
    const error = vi.fn()
    const result = applyFirewall(original, {
      config: resolveConfig(),
      logger: { info: vi.fn(), warn: vi.fn(), error },
      evaluate: () => { throw new Error('forced failure') },
    })

    expect(result).toBe(original)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('forced failure'))
  })

  it('stays fail-open when error logging also fails', () => {
    const original = assembly([{ name: 'plugin:noisy', text: 'text' }])
    expect(() => applyFirewall(original, {
      config: resolveConfig(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: () => { throw new Error('logger unavailable') },
      },
      evaluate: () => { throw new Error('forced failure') },
    })).not.toThrow()
  })

  it('still filters when routine audit logging fails', () => {
    const result = applyFirewall(assembly([{ name: 'plugin:noisy', text: 'text' }]), {
      config: resolveConfig({ blockedSections: ['plugin:noisy'] }),
      logger: {
        info: () => { throw new Error('logger unavailable') },
        warn: () => { throw new Error('logger unavailable') },
        error: vi.fn(),
      },
    })
    expect(result.sections).toEqual([])
  })

  it('bypasses compatible assemblies that expose a complete marker', () => {
    const original = assembly([
      { name: 'complete', text: 'exact prompt', complete: true },
      { name: 'plugin:noisy', text: 'blocked' },
    ])
    const store = new AuditStore(100, true)
    const result = applyFirewall(original, {
      config: resolveConfig({ blockedSections: ['plugin:noisy'] }),
      auditStore: store,
    })
    expect(result).toBe(original)
    expect(store.last()).toMatchObject({ bypassed: true, bypassReason: 'complete prompt detected' })
  })

  it('bounds audit history while retaining known section names', () => {
    const store = new AuditStore(1, true)
    const config = resolveConfig({ mode: 'audit' })
    applyFirewall(assembly([{ name: 'plugin:first', text: 'one' }]), { config, auditStore: store })
    applyFirewall(assembly([{ name: 'plugin:second', text: 'two' }]), { config, auditStore: store })

    expect(store.entries()).toHaveLength(1)
    expect(store.knownSections().map(section => section.name)).toEqual(['plugin:first', 'plugin:second'])
  })
})
