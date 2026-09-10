import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import promptFirewallRemote from '@yadsh/dsh-prompt-firewall/remote'
import {
  CardShell,
  bindSettingsExternalStore,
  registerSettingsCard,
  startVisibilityAwarePolling,
} from '@yadsh/dsh-plugin-kit/client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  PromptFirewallConfig,
  PromptFirewallInspectorSnapshot,
  SectionPolicy,
} from '../types.js'
import { styles } from './styles.js'
import {
  AuditSection,
  InspectorSection,
  LastRequestSection,
  PolicySection,
  RulesSection,
} from './sections.js'

const SETTINGS_NAMESPACE = 'prompt-firewall'
const REFRESH_INTERVAL_MS = 3_000

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

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Could not load Prompt Inspector data.'
}

function PromptFirewallCard({ scope, inspect, setSectionPolicy }: CardProps) {
  const settingsStore = useMemo(() => bindSettingsExternalStore(scope), [scope])
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  )
  const config = settings.value
  const writable = settings.status === 'ready' && settings.writable
  const [inspector, setInspector] = useState<PromptFirewallInspectorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
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
    const stopPolling = startVisibilityAwarePolling(refresh, REFRESH_INTERVAL_MS)
    return () => {
      stopPolling()
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

  const enabled = config?.enabled ?? true

  if (settings.status === 'unavailable') return null

  return (
    <CardShell
      title="Prompt Firewall"
      description="Prompt hygiene, section policy, and request-level observability."
      badge={<span className="dsh-plugin-card__badge">{enabled ? 'Enabled' : 'Disabled'}</span>}
      label={open => `${open ? 'Hide' : 'Show'} settings: Prompt Firewall`}
      bodyClassName="pf-body"
    >
      {error !== null && <div className="pf-error">{error}</div>}

      <PolicySection
        config={config}
        writable={writable}
        setPath={setPath}
        unsetPreset={() => { void scope.unset('preset') }}
      />
      <LastRequestSection
        config={config}
        inspector={inspector}
        refreshing={refreshing}
        onRefresh={() => { void refresh() }}
      />
      <RulesSection config={config} writable={writable} setPath={setPath} />
      <AuditSection config={config} writable={writable} setPath={setPath} />
      <InspectorSection inspector={inspector} writable={writable} setPolicy={setPolicy} />
    </CardShell>
  )
}

export const inject = ['slots', 'settingsScope', 'remote']

/** Mount the generated Remote contribution and register the native Settings card. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote
  const disposeRemote = await remote.$mount(promptFirewallRemote)
  try {
    await ctx.inject(['remote.promptFirewall'], (remoteCtx) => {
      const injectedRemote = remoteCtx.remote as unknown as ClientRemote
      const scope = remoteCtx.settingsScope.bind<PromptFirewallConfig>({ namespace: SETTINGS_NAMESPACE })
      const face: CardFace = {
        scope,
        inspect: () => injectedRemote.promptFirewall.inspect(),
        setSectionPolicy: (section, policy, revision) => (
          injectedRemote.promptFirewall.setSectionPolicy(section, policy, revision)
        ),
      }

      return registerSettingsCard(remoteCtx, {
        key: SETTINGS_NAMESPACE,
        pluginName: 'dsh-prompt-firewall',
        styles,
        component: PromptFirewallCard,
        inject: () => face,
      })
    })
  } catch (cause) {
    await disposeRemote()
    throw cause
  }

  return disposeRemote
}
