import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import PromptFirewall from '../src/index.js'

describe('DSH system-prompt integration', () => {
  it('filters sections added by contributors while preserving core and tool guidance', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(PromptFirewall, {
      blockedSections: ['plugin:announcement'],
    })
    ctx.systemPrompt.section({ name: 'plugin:clean', order: 10, text: 'functional' })
    ctx.systemPrompt.section({ name: 'plugin:announcement', order: 20, text: 'advertisement' })
    ctx.systemPrompt.section({ name: 'tool:fake-tool', order: 100, text: 'tool guidance' })

    const result = await ctx.systemPrompt.assemble()
    expect(result.sections.map(section => section.name)).toEqual([
      'harness:identity',
      'deployment:persona',
      'plugin:clean',
      'tool:fake-tool',
    ])
    expect(ctx.promptFirewall.inspectLast()).toMatchObject({
      totalSections: 5,
      blockedSections: 1,
    })
    expect(ctx.promptFirewall.inspectHistory()).toHaveLength(1)
    expect(ctx.promptFirewall.getMetrics()).toMatchObject({
      requestsTotal: 1,
      sectionsTotal: 5,
      sectionsBlockedTotal: 1,
    })
    expect(ctx.promptFirewall.inspect()).toMatchObject({
      config: { mode: 'blocklist' },
      last: { totalSections: 5, blockedSections: 1 },
      metrics: { requestsTotal: 1 },
    })
    expect(remoteMethods(ctx.promptFirewall).map(method => method.exportName ?? method.method))
      .toEqual(['inspect', 'setSectionPolicy'])
  })

  it('post-processes sections added by later waterfall listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(PromptFirewall, { blockedPrefixes: ['plugin:late:'] })
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      const result = await next()
      result.sections.push({ name: 'plugin:late:announcement', text: 'late noise' })
      return result
    })

    const result = await ctx.systemPrompt.assemble()
    expect(result.sections.map(section => section.name)).not.toContain('plugin:late:announcement')
  })

  it('keeps upstream complete-prompt replacement semantics intact', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(PromptFirewall, { blockedPrefixes: ['plugin:'] })
    ctx.systemPrompt.section({ name: 'complete', order: 10, text: 'Exact prompt.', complete: true })
    ctx.systemPrompt.section({ name: 'plugin:noisy', order: 20, text: 'noise' })

    const result = await ctx.systemPrompt.assemble()
    expect(result.sections).toEqual([{ name: 'complete', text: 'Exact prompt.' }])
  })

  it('removes all known noisy plugins with the clean preset', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(PromptFirewall, { preset: 'clean' })
    for (const name of [
      'plugin:dsh-liangshen',
      'plugin:dsh-ssh',
      'plugin:task-board',
      'plugin:dsh-desktop-launcher',
    ]) {
      ctx.systemPrompt.section({ name, order: 10, text: name })
    }
    ctx.systemPrompt.section({ name: 'tool:run_code', order: 100, text: 'critical' })

    const result = await ctx.systemPrompt.assemble()
    expect(result.sections.map(section => section.name)).toEqual([
      'harness:identity',
      'deployment:persona',
      'tool:run_code',
    ])
  })

  it('lets audit-only and strict presets supply their mode defaults', async () => {
    const auditContext = new Context()
    await auditContext.plugin(SystemPrompt)
    await auditContext.plugin(PromptFirewall, {
      preset: 'audit-only',
      blockedPrefixes: ['plugin:'],
    })
    auditContext.systemPrompt.section({ name: 'plugin:visible', order: 10, text: 'visible' })
    expect((await auditContext.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain('plugin:visible')

    const strictContext = new Context()
    await strictContext.plugin(SystemPrompt)
    await strictContext.plugin(PromptFirewall, { preset: 'strict' })
    strictContext.systemPrompt.section({ name: 'plugin:unknown', order: 10, text: 'unknown' })
    expect((await strictContext.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain('plugin:unknown')
  })
})
