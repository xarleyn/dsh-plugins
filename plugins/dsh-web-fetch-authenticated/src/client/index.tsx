import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import webFetchAuthRemote from '@yadsh/dsh-web-fetch-authenticated/remote'
import {
  CardShell,
  bindSettingsExternalStore,
  registerSettingsCard,
  startVisibilityAwarePolling,
} from '@yadsh/dsh-plugin-kit/client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { validateConfig } from '../rule-validation.js'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type {
  AuthenticatedFetchRule,
  DiagnoseReport,
  ProviderStatusReport,
  RuleTestReport,
  WebFetchAuthConfig,
} from '../types.js'
import { styles } from './styles.js'
import { DiagnosticsSection, GlobalSection, RulesSection, StatusSection, type CardFace } from './sections.js'

const SETTINGS_NAMESPACE = 'web-fetch-authenticated'
const REFRESH_INTERVAL_MS = 5_000

interface RemoteService {
  status(): Promise<RemoteResult<ProviderStatusReport>>
  testRule(ruleId: string, url?: string): Promise<RemoteResult<RuleTestReport>>
  diagnose(url: string): Promise<RemoteResult<DiagnoseReport>>
}

interface ClientRemote {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
  webFetchAuth: RemoteService
}

type CardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<CardFace>

function displayError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Could not load Authenticated Web Fetch data.'
}

function WebFetchAuthCard({ scope, status, testRule, diagnose, credentials }: CardProps) {
  const settingsStore = useMemo(() => bindSettingsExternalStore(scope), [scope])
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  )
  const config = settings.value
  const writable = settings.status === 'ready' && settings.writable
  const [report, setReport] = useState<ProviderStatusReport | undefined>()
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++activeRequest.current
    try {
      const result = await status()
      if (request !== activeRequest.current) return
      if (result.ok) {
        setReport(result.value)
        setError(null)
      } else {
        setError(displayError(result.error))
      }
    } catch (cause) {
      if (request === activeRequest.current) setError(displayError(cause))
    }
  }, [status])

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
    if (field === 'audit') {
      void scope.set(field, { ...current?.audit, [nested]: value })
    } else if (field === 'limits') {
      void scope.set(field, { ...current?.limits, [nested]: value })
    } else if (field === 'defaultPolicy') {
      void scope.set(field, { ...current?.defaultPolicy, [nested]: value })
    }
  }, [scope])

  const setRules = useCallback((rules: AuthenticatedFetchRule[]) => {
    void scope.set('rules', rules)
  }, [scope])

  const warnings = useMemo(() => validateConfig(config ?? {}).warnings, [config])

  if (settings.status === 'unavailable') return null

  return (
    <CardShell
      title="Authenticated Web Fetch"
      description="Per-origin authenticated rules for web_fetch: credentials, SSRF policy, and diagnostics."
      badge={<span className="dsh-plugin-card__badge">{config?.enabled ?? true ? 'Enabled' : 'Disabled'}</span>}
      label={open => `${open ? 'Hide' : 'Show'} settings: Authenticated Web Fetch`}
      bodyClassName="wfa-body"
    >
      {error !== null && <div className="wfa-error">{error}</div>}
      <StatusSection status={report} warnings={warnings} />
      <RulesSection config={config} writable={writable} setRules={setRules} face={{ scope, status, testRule, diagnose, credentials }} />
      <GlobalSection config={config} writable={writable} setPath={setPath} />
      <DiagnosticsSection diagnose={diagnose} />
    </CardShell>
  )
}

export const inject = ['slots', 'settingsScope', 'connection', 'remote']

/** Mount the generated Remote contribution and register the native Settings card. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.remote as unknown as ClientRemote
  const disposeRemote = await remote.$mount(webFetchAuthRemote)
  try {
    await ctx.inject(['remote.webFetchAuth'], (remoteCtx) => {
      const injectedRemote = remoteCtx.remote as unknown as ClientRemote
      const scope = remoteCtx.settingsScope.bind<WebFetchAuthConfig>({ namespace: SETTINGS_NAMESPACE })
      const connection = (remoteCtx as unknown as {
        connection?: { api?: { credentials?: unknown } }
      }).connection
      const credentials = connection?.api?.credentials as IApiClient['credentials']
      const face: CardFace = {
        scope,
        status: () => injectedRemote.webFetchAuth.status(),
        testRule: (ruleId, url) => injectedRemote.webFetchAuth.testRule(ruleId, url),
        diagnose: url => injectedRemote.webFetchAuth.diagnose(url),
        credentials,
      }

      return registerSettingsCard(remoteCtx, {
        key: SETTINGS_NAMESPACE,
        pluginName: 'dsh-web-fetch-authenticated',
        styles,
        component: WebFetchAuthCard,
        inject: () => face,
      })
    })
  } catch (cause) {
    await disposeRemote()
    throw cause
  }

  return disposeRemote
}
