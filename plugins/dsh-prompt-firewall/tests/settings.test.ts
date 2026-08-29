import { Context } from '@deepseek-ai/cordis'
import SettingsProvider, {
  SettingsConflictError,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import PromptFirewall, { PROMPT_FIREWALL_SETTINGS_NAMESPACE } from '../src/index.js'

class MemorySettings extends SettingsProvider {
  private readonly storageDocument: Record<string, unknown>
  override readonly writable = true

  constructor(ctx: Context, document: Record<string, unknown> = {}) {
    super(ctx)
    this.storageDocument = structuredClone(document)
  }

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storageDocument))
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storageDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function configuredContext(base: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(MemorySettings, base)
  await ctx.plugin(PromptFirewall)
  return ctx
}

describe('live settings integration', () => {
  it('registers a live settings namespace', async () => {
    const ctx = await configuredContext()
    const descriptor = ctx.settings.describe().find(
      item => item.ns === PROMPT_FIREWALL_SETTINGS_NAMESPACE,
    )
    expect(descriptor).toMatchObject({
      ns: 'prompt-firewall',
      applies: 'live',
      revision: 0,
    })
  })

  it('persists section actions and reloads rules without restarting', async () => {
    const ctx = await configuredContext()
    ctx.systemPrompt.section({ name: 'plugin:dynamic', order: 10, text: 'dynamic' })
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain('plugin:dynamic')

    await ctx.promptFirewall.setSectionPolicy('plugin:dynamic', 'block')
    await vi.waitFor(() => {
      expect(ctx.promptFirewall.getConfig().blockedSections).toContain('plugin:dynamic')
    })
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain('plugin:dynamic')

    await ctx.promptFirewall.setSectionPolicy('plugin:dynamic', 'allow')
    await vi.waitFor(() => {
      expect(ctx.promptFirewall.evaluateSection({ name: 'plugin:dynamic', text: '' }).action).toBe('allow')
    })
    expect(ctx.promptFirewall.getConfig().blockedSections).not.toContain('plugin:dynamic')

    await ctx.promptFirewall.setSectionPolicy('plugin:dynamic', 'clear')
    await vi.waitFor(() => {
      expect(ctx.promptFirewall.evaluateSection({ name: 'plugin:dynamic', text: '' }))
        .toMatchObject({ action: 'allow', reason: 'blocklist-default' })
    })
    expect(ctx.promptFirewall.getConfig().allowedSections).not.toContain('plugin:dynamic')
  })

  it('supports revision fencing for UI actions', async () => {
    const ctx = await configuredContext()
    await ctx.promptFirewall.setSectionPolicy('plugin:first', 'block', 0)
    await expect(ctx.promptFirewall.setSectionPolicy('plugin:second', 'block', 0))
      .rejects.toBeInstanceOf(SettingsConflictError)
  })

  it('fails clearly when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(PromptFirewall)
    await expect(ctx.promptFirewall.setSectionPolicy('plugin:foo', 'block'))
      .rejects.toThrow('mount a DSH settings provider')
  })
})
