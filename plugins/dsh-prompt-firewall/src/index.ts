import { Context } from '@deepseek-ai/cordis'
import type { AssembledSection, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  createHostLoggerSink,
  getPluginLogger,
  type PluginLogger,
} from '@yadsh/dsh-plugin-log'
import { AuditStore } from './audit.js'
import { ConfigSchema, resolveConfig } from './config.js'
import { applyFirewall } from './firewall.js'
import { FirewallMetrics } from './metrics.js'
import { compileRules, evaluateSection } from './rules.js'
import type {
  FirewallDecision,
  KnownSection,
  PromptAuditResult,
  PromptFirewallConfig,
  PromptFirewallInspectorSnapshot,
  PromptFirewallMetricsSnapshot,
  PromptFirewallService,
  ResolvedPromptFirewallConfig,
  SectionPolicy,
} from './types.js'

export * from './audit.js'
export * from './config.js'
export * from './firewall.js'
export * from './metrics.js'
export * from './presets.js'
export * from './rules.js'
export * from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Inspect and evaluate prompt firewall state without accessing internals. */
    promptFirewall: PromptFirewallService
  }
}

/** Cordis plugin ID. */
export const name = 'prompt-firewall'
export const inject = ['systemPrompt']
export const PROMPT_FIREWALL_SETTINGS_NAMESPACE = settingsNamespace('prompt-firewall')

export type Config = PromptFirewallConfig
export const Config = ConfigSchema

/** DSH Host plugin, public firewall service, and browser Remote owner. */
export class PromptFirewall extends TypertRemoteService implements PromptFirewallService {
  static inject = inject
  static Config = ConfigSchema

  private readonly entryConfig: PromptFirewallConfig
  private configSource: () => PromptFirewallConfig
  private resolvedConfig: ResolvedPromptFirewallConfig
  private compiledRules
  private readonly audits: AuditStore
  private readonly metrics = new FirewallMetrics()
  private readonly logger: PluginLogger

  constructor(ctx: Context, config: PromptFirewallConfig = {}) {
    super(ctx, 'promptFirewall', { namespace: 'promptFirewall' })
    this.logger = getPluginLogger({
      pluginId: 'dsh-prompt-firewall',
      console: 'trace',
      consoleSink: createHostLoggerSink(ctx.logger),
    })
    ctx.effect(
      () => async () => this.logger.close(),
      'dsh-prompt-firewall.logger',
    )
    this.entryConfig = structuredClone(config)
    this.configSource = () => this.entryConfig
    this.resolvedConfig = resolveConfig(config)
    this.compiledRules = compileRules(this.resolvedConfig)
    this.audits = new AuditStore(
      this.resolvedConfig.audit.historySize,
      this.resolvedConfig.audit.highlightNewSections,
    )

    installSettingsSection(
      ctx,
      PROMPT_FIREWALL_SETTINGS_NAMESPACE,
      ConfigSchema,
      this.entryConfig,
      {
        setSource: current => { this.configSource = current },
        onChange: () => { this.reloadRules() },
      },
    )

    // Cordis has registration order plus `prepend`, not numeric priorities.
    // Prepending makes this wrapper call downstream contributors first and
    // apply policy while their final result unwinds back through this listener.
    ctx.on('system-prompt/assemble', async (
      _assembly,
      _context,
      next,
    ): Promise<PromptAssembly> => {
      const result = await next()
      return applyFirewall(result, {
        config: this.resolvedConfig,
        auditStore: this.audits,
        metrics: this.metrics,
        logger: this.logger,
        evaluate: section => evaluateSection(section, this.compiledRules),
      })
    }, { prepend: true })

    this.logger.info('plugin.ready', {
      enabled: this.resolvedConfig.enabled,
      mode: this.resolvedConfig.mode,
    })
  }

  inspectLast(): PromptAuditResult | null {
    return this.audits.last()
  }

  inspectHistory(): PromptAuditResult[] {
    return this.audits.entries()
  }

  getKnownSections(): KnownSection[] {
    return this.audits.knownSections()
  }

  getMetrics(): PromptFirewallMetricsSnapshot {
    return this.metrics.snapshot()
  }

  getConfig(): ResolvedPromptFirewallConfig {
    return structuredClone(this.resolvedConfig)
  }

  /** Return one consistent, content-safe browser inspector projection. */
  @Remote('inspect')
  inspect(): PromptFirewallInspectorSnapshot {
    return {
      config: this.getConfig(),
      last: this.inspectLast(),
      knownSections: this.getKnownSections(),
      metrics: this.getMetrics(),
    }
  }

  evaluateSection(section: AssembledSection): FirewallDecision {
    return evaluateSection(section, this.compiledRules)
  }

  @Remote('setSectionPolicy')
  async setSectionPolicy(
    name: string,
    policy: SectionPolicy,
    expectedRevision?: number,
  ): Promise<void> {
    if (name.length === 0) throw new TypeError('section name must be non-empty')
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new Error('prompt-firewall settings are unavailable; mount a DSH settings provider')
    }

    const current = this.configSource()
    const without = (values: readonly string[] | undefined): string[] => (
      (values ?? []).filter(value => value !== name)
    )
    const allowedSections = without(current.allowedSections)
    const blockedSections = without(current.blockedSections)
    const protectedSections = without(current.protectedSections)
    if (policy === 'allow') allowedSections.push(name)
    else if (policy === 'block') blockedSections.push(name)
    else if (policy === 'protect') protectedSections.push(name)

    await settings.update(PROMPT_FIREWALL_SETTINGS_NAMESPACE, {
      allowedSections,
      blockedSections,
      protectedSections,
    }, expectedRevision)
    // The settings scope has committed synchronously by this point; refresh
    // before the asynchronous watch callback so Remote callers observe their write.
    this.reloadRules()
  }

  reloadRules(): void {
    this.resolvedConfig = resolveConfig(this.configSource())
    this.compiledRules = compileRules(this.resolvedConfig)
    this.audits.configure(
      this.resolvedConfig.audit.historySize,
      this.resolvedConfig.audit.highlightNewSections,
    )
    this.logger.info('firewall.rules.reloaded', {
      enabled: this.resolvedConfig.enabled,
      mode: this.resolvedConfig.mode,
    })
  }
}

export default PromptFirewall
