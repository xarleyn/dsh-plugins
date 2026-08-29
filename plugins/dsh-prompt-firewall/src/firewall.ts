import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { AuditStore, createAuditResult } from './audit.js'
import type { FirewallMetrics } from './metrics.js'
import { compileRules, evaluateSection } from './rules.js'
import type {
  FirewallAssembly,
  FirewallDecision,
  FirewallLogger,
  FirewallSection,
  ResolvedPromptFirewallConfig,
} from './types.js'

export type SectionEvaluator = (section: FirewallSection) => FirewallDecision

export interface ApplyFirewallOptions {
  config: ResolvedPromptFirewallConfig
  auditStore?: AuditStore
  metrics?: FirewallMetrics
  logger?: FirewallLogger
  evaluate?: SectionEvaluator
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateAssembly(assembly: PromptAssembly): asserts assembly is FirewallAssembly {
  if (!Array.isArray(assembly.sections)) throw new TypeError('prompt assembly sections must be an array')
  for (const section of assembly.sections) {
    if (typeof section.name !== 'string' || section.name.length === 0) {
      throw new TypeError('prompt section name must be a non-empty string')
    }
    if (typeof section.text !== 'string') {
      throw new TypeError(`prompt section "${section.name}" text must be a string`)
    }
  }
}

function logAudit(
  audit: ReturnType<typeof createAuditResult>,
  config: ResolvedPromptFirewallConfig,
  logger: FirewallLogger | undefined,
): void {
  if (logger === undefined || !config.audit.enabled) return
  const safeLog = (level: 'info' | 'warn', message: string): void => {
    try {
      logger[level](message)
    } catch {
      // Observability failures must not affect prompt policy.
    }
  }
  safeLog('info',
    `[prompt-firewall] assembled prompt: ${audit.totalSections} sections, `
      + `${audit.charsBefore} chars, ~${audit.estimatedTokensBefore} estimated tokens`,
  )
  for (const section of audit.sections) {
    if (section.decision === 'blocked' && config.audit.logBlocked) {
      safeLog('warn',
        `[prompt-firewall] BLOCK ${section.name}: ${section.reason}, `
          + `${section.chars} chars, ~${section.estimatedTokens} estimated tokens`
          + (section.preview === undefined ? '' : `, preview=${JSON.stringify(section.preview)}`),
      )
    } else if (section.decision !== 'blocked' && config.audit.logAllowed) {
      safeLog('info',
        `[prompt-firewall] ${section.decision.toUpperCase()} ${section.name}: ${section.reason}, `
          + `${section.chars} chars, ~${section.estimatedTokens} estimated tokens`
          + (section.preview === undefined ? '' : `, preview=${JSON.stringify(section.preview)}`),
      )
    }
  }
  if (audit.blockedSections > 0) {
    safeLog('info',
      `[prompt-firewall] result: removed ${audit.blockedSections} sections, `
        + `${audit.charsRemoved} chars, ~${audit.estimatedTokensRemoved} estimated tokens`,
    )
  }
}

/**
 * Filter an already assembled DSH prompt. Any internal error is contained and
 * returns the exact original object (fail-open).
 */
export function applyFirewall(
  assembly: PromptAssembly,
  options: ApplyFirewallOptions,
): PromptAssembly {
  try {
    validateAssembly(assembly)
    const { config } = options
    const rules = options.evaluate === undefined ? compileRules(config) : undefined
    const evaluator = options.evaluate ?? (section => evaluateSection(section, rules!))
    const sections = assembly.sections as FirewallSection[]

    const complete = sections.some(section => section.complete === true)
    const decisions = sections.map(section => (
      complete
        ? { action: 'allow', reason: 'complete-prompt-bypass' } as const
        : evaluator(section)
    ))
    const audit = createAuditResult(
      sections,
      decisions,
      config.audit,
      complete ? 'complete prompt detected' : undefined,
    )

    if (config.audit.enabled) options.auditStore?.record(audit)
    if (config.metrics.enabled) options.metrics?.record(audit)
    logAudit(audit, config, options.logger)

    if (!config.enabled || config.mode === 'off' || config.mode === 'audit' || complete) return assembly
    if (!decisions.some(decision => decision.action === 'block')) return assembly

    return {
      ...assembly,
      sections: assembly.sections.filter((_, index) => decisions[index]?.action !== 'block'),
    }
  } catch (error) {
    try {
      options.logger?.error(
        `[prompt-firewall] internal error; allowing original prompt: ${errorMessage(error)}`,
      )
    } catch {
      // Logging must never turn fail-open into a request failure.
    }
    return assembly
  }
}
