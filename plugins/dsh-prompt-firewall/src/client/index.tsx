import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import promptFirewallRemote from '@yadsh/dsh-prompt-firewall/remote'
import type {
  FirewallAction,
  PromptFirewallConfig,
  PromptFirewallInspectorSnapshot,
  SectionPolicy,
} from '../types.js'
import { styles } from './styles.js'

const SETTINGS_NAMESPACE = 'prompt-firewall'
const REFRESH_INTERVAL_MS = 3_000

type RuleField =
  | 'allowedSections' | 'blockedSections' | 'protectedSections'
  | 'allowedPrefixes' | 'blockedPrefixes'
  | 'allowedPatterns' | 'blockedPatterns'

interface InspectorRemote {
  inspect(): Promise<RemoteResult<PromptFirewallInspectorSnapshot>>
  setSectionPolicy(
    name: string,
    policy: SectionPolicy,
    expectedRevision?: number,
  ): Promise<RemoteResult<void>>
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
  promptFirewall: InspectorRemote
}

interface CardFace {
  scope: SettingsScope<PromptFirewallConfig>
  inspect: InspectorRemote['inspect']
  setSectionPolicy: InspectorRemote['setSectionPolicy']
}

type CardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<CardFace>

const EMPTY_LIST: readonly string[] = Object.freeze([])

function list(config: PromptFirewallConfig | undefined, field: RuleField): readonly string[] {
  return config?.[field] ?? EMPTY_LIST
}

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Could not load Prompt Inspector data.'
}

function Shield() {
  return (
    <span className="pf-shield" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 19 6v5c0 4.8-2.8 8.2-7 10-4.2-1.8-7-5.2-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  )
}

function Toggle(props: {
  checked: boolean
  disabled: boolean
  label: string
  hint: string
  onChange(checked: boolean): void
}) {
  return (
    <label className="pf-toggle-row">
      <span className="pf-toggle-copy"><strong>{props.label}</strong><span>{props.hint}</span></span>
      <input
        className="pf-toggle"
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => { props.onChange(event.currentTarget.checked) }}
      />
    </label>
  )
}

function PromptFirewallCard({ scope, inspect, setSectionPolicy }: CardProps) {
  const settings = useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot)
  const config = settings.value
  const writable = settings.status === 'ready' && settings.writable
  const [inspector, setInspector] = useState<PromptFirewallInspectorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [rule, setRule] = useState('')
  const [ruleKind, setRuleKind] = useState<'exact' | 'prefix' | 'glob'>('exact')
  const [ruleAction, setRuleAction] = useState<FirewallAction>('block')
  const activeRequest = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current
    setRefreshing(true)
    try {
      const result = await inspect()
      if (request !== activeRequest.current) return
      if (result.ok) {
        setInspector(result.value)
        setError(null)
      } else {
        setError(displayError(result.error))
      }
    } catch (cause) {
      if (request === activeRequest.current) setError(displayError(cause))
    } finally {
      if (request === activeRequest.current) setRefreshing(false)
    }
  }, [inspect])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(interval)
      activeRequest.current += 1
    }
  }, [refresh])

  const setPath = useCallback((path: string[], value: unknown) => {
    const [field, nested] = path
    if (field === undefined) return
    if (nested === undefined) {
      void scope.set(field, value)
      return
    }
    const current = scope.getSnapshot().value
    const parent = field === 'audit' ? current?.audit : current?.metrics
    void scope.set(field, { ...parent, [nested]: value })
  }, [scope])

  const setPolicy = useCallback(async (name: string, policy: SectionPolicy) => {
    const current = scope.getSnapshot()
    const result = await setSectionPolicy(name, policy, current.revision)
    if (!result.ok) setError(displayError(result.error))
    await refresh()
  }, [refresh, scope, setSectionPolicy])

  const addRule = (event: FormEvent) => {
    event.preventDefault()
    const value = rule.trim()
    if (value.length === 0) return
    const field: RuleField = ruleAction === 'protect'
      ? 'protectedSections'
      : ruleKind === 'exact'
        ? `${ruleAction === 'allow' ? 'allowed' : 'blocked'}Sections`
        : ruleKind === 'prefix'
          ? `${ruleAction === 'allow' ? 'allowed' : 'blocked'}Prefixes`
          : `${ruleAction === 'allow' ? 'allowed' : 'blocked'}Patterns`
    const values = [...new Set([...list(config, field), value])]
    setPath([field], values)
    setRule('')
  }

  const explicitRules: Array<{ field: RuleField; value: string; kind: string; action: FirewallAction }> = [
    ...list(config, 'allowedSections').map(value => ({ field: 'allowedSections' as const, value, kind: 'exact', action: 'allow' as const })),
    ...list(config, 'blockedSections').map(value => ({ field: 'blockedSections' as const, value, kind: 'exact', action: 'block' as const })),
    ...list(config, 'protectedSections').map(value => ({ field: 'protectedSections' as const, value, kind: 'exact', action: 'protect' as const })),
    ...list(config, 'allowedPrefixes').map(value => ({ field: 'allowedPrefixes' as const, value, kind: 'prefix', action: 'allow' as const })),
    ...list(config, 'blockedPrefixes').map(value => ({ field: 'blockedPrefixes' as const, value, kind: 'prefix', action: 'block' as const })),
    ...list(config, 'allowedPatterns').map(value => ({ field: 'allowedPatterns' as const, value, kind: 'glob', action: 'allow' as const })),
    ...list(config, 'blockedPatterns').map(value => ({ field: 'blockedPatterns' as const, value, kind: 'glob', action: 'block' as const })),
  ]

  const enabled = config?.enabled ?? true
  const last = inspector?.last ?? null
  const effectiveMode = inspector?.config.mode ?? config?.mode ?? 'blocklist'
  const configuredMode = config?.mode
    ?? (config?.preset === 'strict' ? 'allowlist' : config?.preset === 'audit-only' ? 'audit' : 'blocklist')

  return (
    <article className="pf-card">
      <header className="pf-head">
        <div className="pf-title">
          <Shield />
          <div>
            <h2>Prompt Firewall</h2>
            <p>Prompt hygiene, section policy, and request-level observability.</p>
          </div>
        </div>
        <span className={`pf-badge${enabled ? '' : ' off'}`}><i className="pf-dot" />{enabled ? 'Enabled' : 'Disabled'}</span>
      </header>

      <div className="pf-body">
        {settings.status === 'unavailable' && <div className="pf-error">Settings are unavailable for this connection.</div>}
        {error !== null && <div className="pf-error">{error}</div>}

        <section className="pf-section">
          <div className="pf-section-title"><h3>Policy</h3><span className="pf-muted">Changes apply live</span></div>
          <div className="pf-grid">
            <Toggle checked={enabled} disabled={!writable} label="Firewall enabled" hint="Keep auditing available when policy is off." onChange={value => { setPath(['enabled'], value) }} />
            <Toggle checked={config?.protectCoreSections ?? true} disabled={!writable} label="Protect core sections" hint="Prevents ordinary rules from removing Harness internals." onChange={value => { setPath(['protectCoreSections'], value) }} />
            <label className="pf-field"><span>Mode</span>
              <select className="pf-control" value={configuredMode} disabled={!writable} onChange={event => { setPath(['mode'], event.currentTarget.value) }}>
                <option value="off">Off</option><option value="audit">Audit only</option><option value="blocklist">Blocklist</option><option value="allowlist">Allowlist</option>
              </select>
            </label>
            <label className="pf-field"><span>Preset</span>
              <select className="pf-control" value={config?.preset ?? ''} disabled={!writable} onChange={event => {
                const value = event.currentTarget.value
                if (value === '') void scope.unset('preset')
                else setPath(['preset'], value)
              }}>
                <option value="">None</option><option value="clean">Clean</option><option value="strict">Strict</option><option value="audit-only">Audit only</option>
              </select>
            </label>
            <label className="pf-field"><span>Unknown plugin sections</span>
              <select className="pf-control" value={config?.unknownPluginPolicy ?? 'allow'} disabled={!writable} onChange={event => { setPath(['unknownPluginPolicy'], event.currentTarget.value) }}>
                <option value="allow">Allow</option><option value="block">Block</option>
              </select>
            </label>
          </div>
        </section>

        <section className="pf-section">
          <div className="pf-section-title"><h3>Last request</h3><button className="pf-btn" disabled={refreshing} onClick={() => { void refresh() }}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
          <div className="pf-stats">
            <div className="pf-stat"><b>{last?.totalSections ?? '—'}</b><span>sections</span></div>
            <div className="pf-stat"><b>{last?.blockedSections ?? '—'}</b><span>blocked</span></div>
            <div className="pf-stat"><b>{last === null ? '—' : `~${last.estimatedTokensRemoved}`}</b><span>tokens removed (estimate)</span></div>
            <div className="pf-stat"><b>{effectiveMode}</b><span>effective mode</span></div>
          </div>
        </section>

        <section className="pf-section">
          <div className="pf-section-title"><h3>Rules</h3><span className="pf-muted">Explicit rules; preset rules are applied in addition</span></div>
          <form className="pf-editor" onSubmit={addRule}>
            <input className="pf-control" value={rule} disabled={!writable} placeholder="plugin:example or announcement:*" onChange={event => { setRule(event.currentTarget.value) }} />
            <select className="pf-control" value={ruleKind} disabled={!writable || ruleAction === 'protect'} onChange={event => { setRuleKind(event.currentTarget.value as typeof ruleKind) }}>
              <option value="exact">Exact</option><option value="prefix">Prefix</option><option value="glob">Glob</option>
            </select>
            <select className="pf-control" value={ruleAction} disabled={!writable} onChange={event => {
              const action = event.currentTarget.value as FirewallAction
              setRuleAction(action)
              if (action === 'protect') setRuleKind('exact')
            }}>
              <option value="block">Block</option><option value="allow">Allow</option><option value="protect">Protect</option>
            </select>
            <button className="pf-btn primary" type="submit" disabled={!writable || rule.trim().length === 0}>Add rule</button>
          </form>
          <div className="pf-rules">
            {explicitRules.length === 0 && <div className="pf-empty">No explicit rules yet.</div>}
            {explicitRules.map(item => <div className="pf-rule" key={`${item.field}:${item.value}`}>
              <code title={item.value}>{item.value}</code><span className="pf-pill pf-kind">{item.kind}</span><span className={`pf-pill ${item.action}`}>{item.action}</span>
              <button className="pf-btn link danger" disabled={!writable} onClick={() => { setPath([item.field], list(config, item.field).filter(value => value !== item.value)) }}>Remove</button>
            </div>)}
          </div>
        </section>

        <details className="pf-advanced">
          <summary>Audit & metrics</summary>
          <div className="pf-advanced-content pf-grid">
            <Toggle checked={config?.audit?.enabled ?? true} disabled={!writable} label="Audit history" hint="Keep recent assemblies in Host memory." onChange={value => { setPath(['audit', 'enabled'], value) }} />
            <Toggle checked={config?.audit?.includePreview ?? false} disabled={!writable} label="Section preview" hint="Expose only the configured prefix in Inspector." onChange={value => { setPath(['audit', 'includePreview'], value) }} />
            <Toggle checked={config?.audit?.logBlocked ?? true} disabled={!writable} label="Log blocked sections" hint="Names and sizes only unless preview is enabled." onChange={value => { setPath(['audit', 'logBlocked'], value) }} />
            <Toggle checked={config?.audit?.logAllowed ?? false} disabled={!writable} label="Log allowed sections" hint="Useful for initial policy discovery." onChange={value => { setPath(['audit', 'logAllowed'], value) }} />
            <Toggle checked={config?.audit?.highlightNewSections ?? true} disabled={!writable} label="Highlight new plugin sections" hint="Informational only; never blocks automatically." onChange={value => { setPath(['audit', 'highlightNewSections'], value) }} />
            <Toggle checked={config?.metrics?.enabled ?? true} disabled={!writable} label="Aggregate metrics" hint="No arbitrary section-name labels." onChange={value => { setPath(['metrics', 'enabled'], value) }} />
            <label className="pf-field"><span>Preview characters</span><input className="pf-control" type="number" min="0" step="1" value={config?.audit?.previewChars ?? 160} disabled={!writable} onChange={event => { setPath(['audit', 'previewChars'], Number(event.currentTarget.value)) }} /></label>
            <label className="pf-field"><span>History size</span><input className="pf-control" type="number" min="0" step="1" value={config?.audit?.historySize ?? 100} disabled={!writable} onChange={event => { setPath(['audit', 'historySize'], Number(event.currentTarget.value)) }} /></label>
          </div>
        </details>

        <section className="pf-section">
          <div className="pf-section-title"><h3>Prompt Inspector</h3><span className="pf-muted">Updates every 3 seconds</span></div>
          <div className="pf-table-wrap">
            {last === null ? <div className="pf-empty">No audited prompt assembly yet.</div> : <table className="pf-table">
              <thead><tr><th>Section</th><th>Size</th><th>Decision</th><th>Reason</th><th>Policy</th></tr></thead>
              <tbody>{last.sections.map((section, index) => <tr key={`${section.name}:${index}`}>
                <td><div className="pf-section-name"><span>{section.name}</span>{section.isNew && <span className="pf-new">NEW</span>}{section.suspicious && <span className="pf-warn">POSSIBLE ANNOUNCEMENT</span>}</div>{section.preview !== undefined && <div className="pf-preview">{section.preview}</div>}</td>
                <td>~{section.estimatedTokens} t<br /><span className="pf-muted">{section.chars} chars</span></td>
                <td><span className={`pf-pill ${section.decision === 'blocked' ? 'block' : section.decision === 'protected' ? 'protect' : 'allow'}`}>{section.decision}</span></td>
                <td>{section.reason}</td>
                <td><div className="pf-actions">
                  <button className="pf-btn link" disabled={!writable} onClick={() => { void setPolicy(section.name, 'allow') }}>Allow</button>
                  <button className="pf-btn link danger" disabled={!writable} onClick={() => { void setPolicy(section.name, 'block') }}>Block</button>
                  <button className="pf-btn link" disabled={!writable} onClick={() => { void setPolicy(section.name, 'protect') }}>Protect</button>
                  <button className="pf-btn link" disabled={!writable} onClick={() => { void setPolicy(section.name, 'clear') }}>Clear</button>
                </div></td>
              </tr>)}</tbody>
            </table>}
          </div>
          <p className="pf-footer-note">Token counts are estimates. Prompt Firewall is a hygiene and observability layer, not a security boundary.</p>
        </section>
      </div>
    </article>
  )
}

export const inject = ['slots', 'settingsScope', 'remote']

/** Mount the generated Remote contribution and register the native Settings card. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote
  const disposeRemote = await remote.$mount(promptFirewallRemote)
  const scope = ctx.settingsScope.bind<PromptFirewallConfig>({ namespace: SETTINGS_NAMESPACE })
  const face: CardFace = {
    scope,
    inspect: () => remote.promptFirewall.inspect(),
    setSectionPolicy: (section, policy, revision) => (
      remote.promptFirewall.setSectionPolicy(section, policy, revision)
    ),
  }

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-prompt-firewall'
  style.textContent = styles
  document.head.appendChild(style)

  const disposeSlot = ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    inject: () => face,
  }, PromptFirewallCard))

  return async () => {
    disposeSlot()
    style.remove()
    await disposeRemote()
  }
}
