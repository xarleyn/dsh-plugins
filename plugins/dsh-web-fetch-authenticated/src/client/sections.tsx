/**
 * Sections of the Authenticated Web Fetch settings card (SPEC §6). All state
 * shown here is sanitized by construction: no component ever receives a
 * credential value — the credential control stages a write-only input and
 * asks the credentials domain only for configured/writable facts.
 * @module client/sections
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CredentialInfo } from '@deepseek-ai/dsh-credentials/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  authSummary,
  formatBytes,
  listToText,
  networkFromDraft,
  networkToDraft,
  newRuleId,
  originSummary,
  parsePositiveInt,
  textToList,
  type NetworkDraft,
} from './format.js'
import { validateRule } from '../rule-validation.js'
import type {
  AuthType,
  DiagnoseReport,
  ProviderStatusReport,
  RedirectMode,
  RuleTestReport,
  WebFetchAuthConfig,
  AuthenticatedFetchRule,
} from '../types.js'

/** Client face of the Host `credentials` Remote namespace (values never ride it). */
export interface CredentialsRemote {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult<void>>
  unset(ref: string): Promise<RemoteResult<void>>
}

/** Client face injected into the card. */
export interface CardFace {
  scope: SettingsScope<WebFetchAuthConfig>
  status: () => Promise<RemoteResult<ProviderStatusReport>>
  testRule: (ruleId: string, url?: string) => Promise<RemoteResult<RuleTestReport>>
  diagnose: (url: string) => Promise<RemoteResult<DiagnoseReport>>
  credentials: CredentialsRemote
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'err'; children: string }): JSX.Element {
  return <span className={`wfa-pill ${tone}`}>{children}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="wfa-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Provider overview: status, selection, counts, config errors (SPEC §6.1). */
export function StatusSection({ status: report, warnings }: {
  status: ProviderStatusReport | undefined
  warnings: readonly string[]
}): JSX.Element {
  if (report === undefined) {
    return <div className="wfa-empty">Loading provider status…</div>
  }
  const selection = report.fetchProviderId === undefined
    ? 'not pinned (auto-select)'
    : report.fetchProviderId === 'authenticated'
      ? 'pinned to "authenticated"'
      : `pinned to "${report.fetchProviderId}" — rules are inert until ctx.web selects this provider`
  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Provider</h3>
        <Pill tone={report.enabled ? 'ok' : 'warn'}>{report.enabled ? 'Enabled' : 'Disabled'}</Pill>
      </div>
      <p className="wfa-muted">
        {report.ruleCount} rule(s), {report.enabledRuleCount} enabled · ctx.web fetchProvider: {selection} · unmatched URLs:{' '}
        {report.unmatchedPolicy === 'block' ? 'blocked (strict)' : String(report.unmatchedPolicy)}
      </p>
      {report.configErrors.length > 0 && (
        <div className="wfa-error">
          {report.configErrors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="wfa-warnings">
          {warnings.map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </div>
      )}
      {report.credentialStates.map(state => (
        <p className="wfa-muted" key={state.ref}>
          Credential <code>{state.ref}</code>: {state.configured ? 'configured' : 'not configured'}
          {state.writable ? '' : ' (read-only source — set via the environment)'}
        </p>
      ))}
    </section>
  )
}

function ToggleRow({ title, hint, checked, disabled, onChange }: {
  title: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="wfa-toggle-row">
      <span className="wfa-toggle-copy">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
      <input
        className="wfa-toggle"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onChange={event => {
          onChange(event.target.checked)
        }}
      />
    </div>
  )
}

/** Global switch and limit defaults (SPEC §23). */
export function GlobalSection({ config, writable, setPath }: {
  config: WebFetchAuthConfig | undefined
  writable: boolean
  setPath: (path: string[], value: unknown) => void
}): JSX.Element {
  const limits = config?.limits
  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Global</h3>
      </div>
      <ToggleRow
        title="Provider enabled"
        hint="Disabled providers report unavailable to ctx.web."
        checked={config?.enabled ?? true}
        disabled={!writable}
        onChange={next => {
          setPath(['enabled'], next)
        }}
      />
      <ToggleRow
        title="Audit log"
        hint="Sanitized per-request records in the plugin log; never secrets."
        checked={config?.audit?.enabled ?? true}
        disabled={!writable}
        onChange={next => {
          setPath(['audit', 'enabled'], next)
        }}
      />
      <div className="wfa-grid">
        <Field label="Default timeout (ms)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={limits?.timeoutMs === undefined ? '' : String(limits.timeoutMs)}
            onChange={event => {
              const value = parsePositiveInt(event.target.value)
              const current = config?.limits ?? {}
              if (value === undefined && event.target.value.trim() !== '') return
              const next = { ...current }
              if (value === undefined) delete next.timeoutMs
              else next.timeoutMs = value
              setPath(['limits'], next)
            }}
          />
        </Field>
        <Field label="Max response size (bytes)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={limits?.maxResponseBytes === undefined ? '' : String(limits.maxResponseBytes)}
            onChange={event => {
              const value = parsePositiveInt(event.target.value)
              const current = config?.limits ?? {}
              if (value === undefined && event.target.value.trim() !== '') return
              const next = { ...current }
              if (value === undefined) delete next.maxResponseBytes
              else next.maxResponseBytes = value
              setPath(['limits'], next)
            }}
          />
        </Field>
        <Field label="Max decoded body (chars)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={limits?.maxBodyChars === undefined ? '' : String(limits.maxBodyChars)}
            onChange={event => {
              const value = parsePositiveInt(event.target.value)
              const current = config?.limits ?? {}
              if (value === undefined && event.target.value.trim() !== '') return
              const next = { ...current }
              if (value === undefined) delete next.maxBodyChars
              else next.maxBodyChars = value
              setPath(['limits'], next)
            }}
          />
        </Field>
      </div>
    </section>
  )
}

// ---- Rule draft plumbing ----

interface RuleDraft {
  id: string
  name: string
  description: string
  enabled: boolean
  testUrl: string
  schemesHttp: boolean
  hosts: string
  ports: string
  allowPaths: string
  denyPaths: string
  authType: AuthType
  bearerRef: string
  basicUsername: string
  basicPasswordRef: string
  headerName: string
  headerRef: string
  headerPrefix: string
  network: NetworkDraft
  redirectMode: RedirectMode
  maxRedirects: string
  allowedOrigins: string
  timeoutMs: string
  maxResponseBytes: string
  maxBodyChars: string
}

function ruleToDraft(rule: AuthenticatedFetchRule): RuleDraft {
  const auth = rule.auth
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    testUrl: rule.testUrl ?? '',
    schemesHttp: rule.match.schemes?.includes('http') === true,
    hosts: listToText(rule.match.hosts),
    ports: rule.match.ports === undefined ? '' : rule.match.ports.join(', '),
    allowPaths: listToText(rule.match.allowPaths),
    denyPaths: listToText(rule.match.denyPaths),
    authType: auth.type,
    bearerRef: auth.type === 'bearer' ? auth.credential : '',
    basicUsername: auth.type === 'basic' ? auth.username : '',
    basicPasswordRef: auth.type === 'basic' ? auth.passwordCredential : '',
    headerName: auth.type === 'header' ? auth.headerName : '',
    headerRef: auth.type === 'header' ? auth.credential : '',
    headerPrefix: auth.type === 'header' ? auth.prefix ?? '' : '',
    network: networkToDraft(rule.networkPolicy),
    redirectMode: rule.redirects?.mode ?? 'same-origin',
    maxRedirects: rule.redirects?.maxRedirects === undefined ? '' : String(rule.redirects.maxRedirects),
    allowedOrigins: listToText(rule.redirects?.allowedOrigins),
    timeoutMs: rule.limits?.timeoutMs === undefined ? '' : String(rule.limits.timeoutMs),
    maxResponseBytes: rule.limits?.maxResponseBytes === undefined ? '' : String(rule.limits.maxResponseBytes),
    maxBodyChars: rule.limits?.maxBodyChars === undefined ? '' : String(rule.limits.maxBodyChars),
  }
}

function emptyDraft(): RuleDraft {
  return {
    id: newRuleId(),
    name: '',
    description: '',
    enabled: true,
    testUrl: '',
    schemesHttp: false,
    hosts: '',
    ports: '',
    allowPaths: '',
    denyPaths: '',
    authType: 'bearer',
    bearerRef: '',
    basicUsername: '',
    basicPasswordRef: '',
    headerName: '',
    headerRef: '',
    headerPrefix: '',
    network: networkToDraft(undefined),
    redirectMode: 'same-origin',
    maxRedirects: '',
    allowedOrigins: '',
    timeoutMs: '',
    maxResponseBytes: '',
    maxBodyChars: '',
  }
}

function draftToRule(draft: RuleDraft): { rule: AuthenticatedFetchRule; errors: string[] } {
  const errors: string[] = []
  const hosts = textToList(draft.hosts)
  const portsText = draft.ports.trim()
  let ports: number[] | undefined
  if (portsText.length > 0) {
    const parts = portsText.split(/[,\s]+/u)
    if (parts.some(part => !/^\d+$/u.test(part))) errors.push('Ports must be integers separated by commas.')
    else ports = parts.map(part => Number(part))
  }
  const auth: AuthenticatedFetchRule['auth'] =
    draft.authType === 'none'
      ? { type: 'none' }
      : draft.authType === 'bearer'
        ? { type: 'bearer', credential: draft.bearerRef.trim() }
        : draft.authType === 'basic'
          ? { type: 'basic', username: draft.basicUsername.trim(), passwordCredential: draft.basicPasswordRef.trim() }
          : {
              type: 'header',
              headerName: draft.headerName.trim(),
              credential: draft.headerRef.trim(),
              ...(draft.headerPrefix.trim().length > 0 ? { prefix: draft.headerPrefix } : {}),
            }
  const maxRedirects = parsePositiveInt(draft.maxRedirects)
  if (draft.maxRedirects.trim() !== '' && maxRedirects === undefined) {
    errors.push('Max redirects must be a non-negative integer.')
  }
  const allowedOrigins = textToList(draft.allowedOrigins)
  const rule: AuthenticatedFetchRule = {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    match: {
      ...(draft.schemesHttp ? { schemes: ['https', 'http' as const] } : {}),
      hosts,
      ...(ports === undefined ? {} : { ports }),
      ...(textToList(draft.allowPaths).length > 0 ? { allowPaths: textToList(draft.allowPaths) } : {}),
      ...(textToList(draft.denyPaths).length > 0 ? { denyPaths: textToList(draft.denyPaths) } : {}),
    },
    auth,
    networkPolicy: networkFromDraft(draft.network),
    redirects: {
      mode: draft.redirectMode,
      ...(maxRedirects === undefined ? {} : { maxRedirects }),
      ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    },
    limits: buildLimits(draft, errors),
  }
  if (draft.description.trim().length > 0) rule.description = draft.description.trim()
  if (draft.testUrl.trim().length > 0) rule.testUrl = draft.testUrl.trim()
  errors.push(...validateRule(rule, 0))
  return { rule, errors: [...new Set(errors)] }
}

function buildLimits(draft: RuleDraft, errors: string[]): AuthenticatedFetchRule['limits'] {
  const limits: NonNullable<AuthenticatedFetchRule['limits']> = {}
  const timeout = parsePositiveInt(draft.timeoutMs)
  if (draft.timeoutMs.trim() !== '' && timeout === undefined) errors.push('Timeout must be a positive integer.')
  if (timeout !== undefined) limits.timeoutMs = timeout
  const bytes = parsePositiveInt(draft.maxResponseBytes)
  if (draft.maxResponseBytes.trim() !== '' && bytes === undefined) errors.push('Max response size must be a positive integer.')
  if (bytes !== undefined) limits.maxResponseBytes = bytes
  const chars = parsePositiveInt(draft.maxBodyChars)
  if (draft.maxBodyChars.trim() !== '' && chars === undefined) errors.push('Max body chars must be a positive integer.')
  if (chars !== undefined) limits.maxBodyChars = chars
  return limits
}

/** Write-only credential control (SPEC §6.2/§21): values leave once, never return. */
function CredentialControl({ refName, onRefChange, credentials }: {
  refName: string
  onRefChange: (next: string) => void
  credentials: CardFace['credentials']
}): JSX.Element {
  const [secret, setSecret] = useState('')
  const [state, setState] = useState<{ configured: boolean; writable: boolean } | undefined>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>()
  const activeRef = useRef(refName)

  useEffect(() => {
    activeRef.current = refName
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(refName)) {
      setState(undefined)
      return
    }
    let cancelled = false
    void credentials.describe([refName]).then(response => {
      if (cancelled) return
      if (response.ok) {
        const view = response.value[refName]
        setState({ configured: view?.configured ?? false, writable: view?.writable ?? true })
      } else {
        setState(undefined)
      }
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refName, credentials])

  const save = useCallback(async () => {
    if (secret.length === 0) return
    setBusy(true)
    setMessage(undefined)
    try {
      const written = await credentials.set(refName, secret)
      if (!written.ok) {
        setMessage('The Host refused the write (read-only source?).')
        return
      }
      setSecret('')
      const response = await credentials.describe([refName])
      if (response.ok) {
        const view = response.value[refName]
        setState({ configured: view?.configured ?? false, writable: view?.writable ?? true })
      }
      setMessage('Credential stored.')
    } catch {
      setMessage('The Host refused the write (read-only source?).')
    } finally {
      setBusy(false)
    }
  }, [credentials, refName, secret])

  const clear = useCallback(async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      const removed = await credentials.unset(refName)
      if (!removed.ok) {
        setMessage('The Host refused the removal.')
        return
      }
      const response = await credentials.describe([refName])
      if (response.ok) {
        const view = response.value[refName]
        setState({ configured: view?.configured ?? false, writable: view?.writable ?? true })
      }
      setMessage('Credential removed.')
    } catch {
      setMessage('The Host refused the removal.')
    } finally {
      setBusy(false)
    }
  }, [credentials, refName])

  return (
    <div className="wfa-field">
      <span>Credential</span>
      <div className="wfa-grid">
        <Field label="Reference name">
          <input
            className="wfa-control"
            value={refName}
            placeholder="CORP_JIRA_TOKEN"
            onChange={event => {
              onRefChange(event.target.value)
            }}
          />
        </Field>
        <Field label={`Secret value ${state?.configured === true ? '(configured — leave blank to keep)' : ''}`}>
          <input
            className="wfa-control"
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={state?.configured === true ? '••••••••' : 'paste the secret'}
            onChange={event => {
              setSecret(event.target.value)
            }}
          />
        </Field>
      </div>
      <div className="wfa-actions">
        <Pill tone={state === undefined ? 'warn' : state.configured ? 'ok' : 'err'}>
          {state === undefined ? 'unknown' : state.configured ? 'configured' : 'not configured'}
        </Pill>
        <button
          className="wfa-btn"
          type="button"
          disabled={busy || secret.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(refName)}
          onClick={() => {
            void save()
          }}
        >
          Save secret
        </button>
        <button
          className="wfa-btn danger"
          type="button"
          disabled={busy || state?.configured !== true}
          onClick={() => {
            void clear()
          }}
        >
          Remove
        </button>
      </div>
      {message !== undefined && <p className="wfa-note">{message}</p>}
      <p className="wfa-note">
        The secret is written once to the DSH credential store under the reference name above; the rule config keeps only
        the name. Values are never returned to this page.
      </p>
    </div>
  )
}

/** Add/Edit rule form (SPEC §6.2). */
function RuleEditor({ initial, credentials, onSave, onCancel }: {
  initial: AuthenticatedFetchRule | undefined
  credentials: CardFace['credentials']
  onSave: (rule: AuthenticatedFetchRule) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState<RuleDraft>(() => (initial === undefined ? emptyDraft() : ruleToDraft(initial)))
  const patch = (changes: Partial<RuleDraft>): void => {
    setDraft(current => ({ ...current, ...changes }))
  }
  const { rule, errors } = draftToRule(draft)
  const credentialRef = draft.authType === 'bearer' || draft.authType === 'header'
    ? (draft.authType === 'bearer' ? draft.bearerRef : draft.headerRef).trim()
    : draft.basicPasswordRef.trim()

  return (
    <div className="wfa-editor">
      <div className="wfa-grid">
        <Field label="Rule name">
          <input className="wfa-control" value={draft.name} onChange={event => { patch({ name: event.target.value }) }} />
        </Field>
        <Field label="Description">
          <input className="wfa-control" value={draft.description} onChange={event => { patch({ description: event.target.value }) }} />
        </Field>
      </div>
      <ToggleRow
        title="Enabled"
        hint="Disabled rules never match."
        checked={draft.enabled}
        disabled={false}
        onChange={next => { patch({ enabled: next }) }}
      />

      <div className="wfa-grid">
        <Field label="Hostnames (one per line, exact)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.hosts}
            placeholder={'jira.example.corp\nwiki.example.corp'}
            onChange={event => { patch({ hosts: event.target.value }) }}
          />
        </Field>
        <Field label="Ports (optional, comma separated)">
          <input className="wfa-control" value={draft.ports} placeholder="443, 8443" onChange={event => { patch({ ports: event.target.value }) }} />
        </Field>
      </div>
      <ToggleRow
        title="Allow http://"
        hint="HTTPS is always allowed; adding http warns and transmits the credential unencrypted."
        checked={draft.schemesHttp}
        disabled={false}
        onChange={next => { patch({ schemesHttp: next }) }}
      />
      <div className="wfa-grid">
        <Field label="Allowed path patterns (optional, one per line)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.allowPaths}
            placeholder={'/browse/**\n/rest/api/**'}
            onChange={event => { patch({ allowPaths: event.target.value }) }}
          />
        </Field>
        <Field label="Denied path patterns (optional)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.denyPaths}
            placeholder="/rest/api/*/settings/**"
            onChange={event => { patch({ denyPaths: event.target.value }) }}
          />
        </Field>
      </div>

      <div className="wfa-grid">
        <Field label="Authentication">
          <select
            className="wfa-control"
            value={draft.authType}
            onChange={event => { patch({ authType: event.target.value as AuthType }) }}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
            <option value="header">API key header</option>
          </select>
        </Field>
        {draft.authType === 'header' && (
          <Field label="Header name">
            <input
              className="wfa-control"
              value={draft.headerName}
              placeholder="X-API-Key"
              onChange={event => { patch({ headerName: event.target.value }) }}
            />
          </Field>
        )}
        {draft.authType === 'basic' && (
          <Field label="Username">
            <input className="wfa-control" value={draft.basicUsername} onChange={event => { patch({ basicUsername: event.target.value }) }} />
          </Field>
        )}
      </div>
      {draft.authType === 'header' && (
        <div className="wfa-grid">
          <Field label="Value prefix (optional)">
            <input className="wfa-control" value={draft.headerPrefix} placeholder="ApiKey " onChange={event => { patch({ headerPrefix: event.target.value }) }} />
          </Field>
        </div>
      )}
      {draft.authType !== 'none' && (
        <CredentialControl
          refName={credentialRef}
          onRefChange={next => {
            if (draft.authType === 'bearer') patch({ bearerRef: next })
            else if (draft.authType === 'basic') patch({ basicPasswordRef: next })
            else patch({ headerRef: next })
          }}
          credentials={credentials}
        />
      )}

      <details className="wfa-advanced">
        <summary>Network policy, redirects, and limits</summary>
        <div className="wfa-advanced-content">
          <div className="wfa-checks">
            {(
              [
                ['allowPublic', 'Public IPs'],
                ['allowPrivate', 'Private networks (RFC1918)'],
                ['allowLoopback', 'Loopback'],
                ['allowLinkLocal', 'Link-local'],
                ['allowCGNAT', 'Carrier-grade NAT'],
                ['allowIPv6ULA', 'IPv6 unique-local'],
              ] as const
            ).map(([key, label]) => (
              <label className="wfa-check" key={key}>
                <input
                  type="checkbox"
                  checked={draft.network[key]}
                  onChange={event => { patch({ network: { ...draft.network, [key]: event.target.checked } }) }}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="wfa-grid">
            <Field label="Allowed CIDRs (one per line)">
              <textarea className="wfa-control" rows={2} value={draft.network.allowedCidrs} placeholder="10.20.0.0/16" onChange={event => { patch({ network: { ...draft.network, allowedCidrs: event.target.value } }) }} />
            </Field>
            <Field label="Denied CIDRs (one per line)">
              <textarea className="wfa-control" rows={2} value={draft.network.deniedCidrs} onChange={event => { patch({ network: { ...draft.network, deniedCidrs: event.target.value } }) }} />
            </Field>
          </div>
          <div className="wfa-grid">
            <Field label="Redirects">
              <select
                className="wfa-control"
                value={draft.redirectMode}
                onChange={event => { patch({ redirectMode: event.target.value as RedirectMode }) }}
              >
                <option value="same-origin">Same-origin only (recommended)</option>
                <option value="none">No redirects</option>
                <option value="allowlist">Explicit origin allowlist</option>
              </select>
            </Field>
            <Field label="Max redirects">
              <input className="wfa-control" value={draft.maxRedirects} placeholder="3" onChange={event => { patch({ maxRedirects: event.target.value }) }} />
            </Field>
          </div>
          {draft.redirectMode === 'allowlist' && (
            <Field label="Allowed redirect origins (one per line)">
              <textarea className="wfa-control" rows={2} value={draft.allowedOrigins} placeholder="https://sso.example.corp" onChange={event => { patch({ allowedOrigins: event.target.value }) }} />
            </Field>
          )}
          <div className="wfa-grid">
            <Field label="Timeout (ms)">
              <input className="wfa-control" value={draft.timeoutMs} placeholder="30000" onChange={event => { patch({ timeoutMs: event.target.value }) }} />
            </Field>
            <Field label="Max response bytes">
              <input className="wfa-control" value={draft.maxResponseBytes} placeholder="5242880" onChange={event => { patch({ maxResponseBytes: event.target.value }) }} />
            </Field>
            <Field label="Max decoded chars">
              <input className="wfa-control" value={draft.maxBodyChars} placeholder="100000" onChange={event => { patch({ maxBodyChars: event.target.value }) }} />
            </Field>
            <Field label="Test URL (optional, used by Test)">
              <input className="wfa-control" value={draft.testUrl} placeholder="https://jira.example.corp/status" onChange={event => { patch({ testUrl: event.target.value }) }} />
            </Field>
          </div>
        </div>
      </details>

      {errors.length > 0 && (
        <div className="wfa-error">
          {errors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}
      <div className="wfa-actions">
        <button
          className="wfa-btn primary"
          type="button"
          disabled={errors.length > 0}
          onClick={() => { onSave(rule) }}
        >
          Save rule
        </button>
        <button className="wfa-btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Per-rule connection tester (SPEC §6.3). */
function RuleTester({ ruleId, defaultUrl, testRule }: {
  ruleId: string
  defaultUrl: string
  testRule: CardFace['testRule']
}): JSX.Element {
  const [url, setUrl] = useState(defaultUrl)
  const [report, setReport] = useState<RuleTestReport | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  return (
    <div className="wfa-editor">
      <div className="wfa-actions">
        <input
          className="wfa-control"
          style={{ flex: 1 }}
          value={url}
          placeholder="https://jira.example.corp/browse/MDC-123"
          onChange={event => { setUrl(event.target.value) }}
        />
        <button
          className="wfa-btn primary"
          type="button"
          disabled={busy || url.trim().length === 0}
          onClick={() => {
            setBusy(true)
            setError(undefined)
            void testRule(ruleId, url.trim()).then(result => {
              if (result.ok) setReport(result.value)
              else setError(result.error.message)
            }).catch(cause => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }).finally(() => { setBusy(false) })
          }}
        >
          Run test
        </button>
      </div>
      {error !== undefined && <div className="wfa-error">{error}</div>}
      {report !== undefined && <TestReport report={report} />}
    </div>
  )
}

function TestReport({ report }: { report: RuleTestReport }): JSX.Element {
  return (
    <div className="wfa-report">
      <div>
        <Pill tone={report.ok ? 'ok' : 'err'}>{report.outcome}</Pill>{' '}
        {report.statusCode !== undefined && <b>HTTP {report.statusCode}</b>}
        {report.contentType !== undefined && <> · {report.contentType}</>}
        {report.responseBytes !== undefined && <> · {formatBytes(report.responseBytes)}</>}
        <> · {report.redirectCount} redirect(s)</>
        <> · {report.durationMs} ms</>
      </div>
      <div>
        <b>Auth applied:</b> {report.authApplied ? 'yes' : 'no'}
        {report.credentialState !== undefined && (
          <> · <b>Credential</b> {report.credentialState.ref}: {report.credentialState.configured ? 'configured' : 'missing'}</>
        )}
      </div>
      {report.addresses.length > 0 && (
        <div>
          <b>Resolved:</b>{' '}
          {report.addresses.map(address => `${address.address} (${address.networkClass}${address.allowed ? '' : ', DENIED'})`).join(', ')}
        </div>
      )}
      {report.finalOrigin !== undefined && (
        <div><b>Final origin:</b> {report.finalOrigin}</div>
      )}
      {report.detail !== undefined && <pre>{report.detail}</pre>}
      {report.preview !== undefined && <pre>{report.preview}</pre>}
    </div>
  )
}

/** Diagnostics without an HTTP request (SPEC §6.4). */
export function DiagnosticsSection({ diagnose }: { diagnose: CardFace['diagnose'] }): JSX.Element {
  const [url, setUrl] = useState('')
  const [report, setReport] = useState<DiagnoseReport | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Diagnostics</h3>
        <span className="wfa-note">Match and network policy only — no request is sent.</span>
      </div>
      <div className="wfa-actions">
        <input
          className="wfa-control"
          style={{ flex: 1 }}
          value={url}
          placeholder="https://jira.example.corp/browse/MDC-123"
          onChange={event => { setUrl(event.target.value) }}
        />
        <button
          className="wfa-btn"
          type="button"
          disabled={busy || url.trim().length === 0}
          onClick={() => {
            setBusy(true)
            setError(undefined)
            void diagnose(url.trim()).then(result => {
              if (result.ok) setReport(result.value)
              else setError(result.error.message)
            }).catch(cause => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }).finally(() => { setBusy(false) })
          }}
        >
          Diagnose
        </button>
      </div>
      {error !== undefined && <div className="wfa-error">{error}</div>}
      {report !== undefined && (
        <div className="wfa-report">
          <div><b>URL:</b> {report.validUrl ? report.url : `${report.url} (invalid)`}</div>
          <div>
            <b>Matched rule:</b> {report.match.ruleId === undefined ? report.match.reason : `${report.match.ruleName ?? report.match.ruleId} (${report.match.ruleId})`}
          </div>
          <div><b>Network:</b> {report.networkAllowed ? 'allowed' : 'denied'}</div>
          <div><b>Redirects:</b> {report.redirectPolicy.length > 0 ? report.redirectPolicy : '—'}</div>
          {report.credentialState !== undefined && (
            <div>
              <b>Credential:</b> {report.credentialState.ref} ({report.credentialState.configured ? 'configured' : 'missing'})
            </div>
          )}
          {report.addresses.length > 0 && (
            <div>
              <b>Resolved:</b>{' '}
              {report.addresses.map(address => `${address.address} (${address.networkClass}${address.allowed ? '' : ', DENIED'})`).join(', ')}
            </div>
          )}
          {report.detail !== undefined && <pre>{report.detail}</pre>}
        </div>
      )}
    </section>
  )
}

/** The rule table (SPEC §6.1) with inline editor and tester. */
export function RulesSection({ config, writable, setRules, face }: {
  config: WebFetchAuthConfig | undefined
  writable: boolean
  setRules: (rules: AuthenticatedFetchRule[]) => void
  face: CardFace
}): JSX.Element {
  const rules = config?.rules ?? []
  const [editingId, setEditingId] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [testingId, setTestingId] = useState<string | undefined>()

  const saveRule = (rule: AuthenticatedFetchRule): void => {
    const index = rules.findIndex(candidate => candidate.id === rule.id)
    const next = index >= 0 ? rules.map(candidate => (candidate.id === rule.id ? rule : candidate)) : [...rules, rule]
    setRules(next)
    setEditingId(undefined)
    setCreating(false)
  }
  const deleteRule = (id: string): void => {
    setRules(rules.filter(rule => rule.id !== id))
  }
  const toggleRule = (id: string, enabled: boolean): void => {
    setRules(rules.map(rule => (rule.id === id ? { ...rule, enabled } : rule)))
  }

  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Rules</h3>
        <button
          className="wfa-btn"
          type="button"
          disabled={!writable}
          onClick={() => { setCreating(true); setEditingId(undefined) }}
        >
          Add rule
        </button>
      </div>
      {rules.length === 0 && creating === false && (
        <div className="wfa-empty">
          No rules yet. Every URL is rejected until a rule matches (strict mode).
        </div>
      )}
      <div className="wfa-rules">
        {rules.map(rule => (
          <div key={rule.id}>
            <div className="wfa-rule">
              <span className="wfa-rule-main">
                <span className="wfa-rule-name">{rule.name}</span>
                <span className="wfa-rule-origin">{originSummary(rule)}</span>
              </span>
              <span className="wfa-actions" style={{ gap: 5 }}>
                <Pill tone={rule.enabled ? 'ok' : 'warn'}>{rule.enabled ? 'enabled' : 'disabled'}</Pill>
                <Pill tone="warn">{authSummary(rule.auth)}</Pill>
              </span>
              <span className="wfa-actions">
                <button className="wfa-btn link" type="button" disabled={!writable} onClick={() => { toggleRule(rule.id, !rule.enabled) }}>
                  {rule.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="wfa-btn link" type="button" onClick={() => { setTestingId(testingId === rule.id ? undefined : rule.id); setEditingId(undefined); setCreating(false) }}>
                  Test
                </button>
                <button
                  className="wfa-btn link"
                  type="button"
                  disabled={!writable}
                  onClick={() => { setEditingId(editingId === rule.id ? undefined : rule.id); setCreating(false); setTestingId(undefined) }}
                >
                  Edit
                </button>
                <button className="wfa-btn link danger" type="button" disabled={!writable} onClick={() => { deleteRule(rule.id) }}>
                  Delete
                </button>
              </span>
            </div>
            {testingId === rule.id && (
              <RuleTester
                ruleId={rule.id}
                defaultUrl={rule.testUrl ?? ''}
                testRule={face.testRule}
              />
            )}
            {editingId === rule.id && (
              <div style={{ paddingTop: 6 }}>
                <RuleEditor
                  initial={rule}
                  credentials={face.credentials}
                  onSave={saveRule}
                  onCancel={() => { setEditingId(undefined) }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && (
        <RuleEditor
          initial={undefined}
          credentials={face.credentials}
          onSave={saveRule}
          onCancel={() => { setCreating(false) }}
        />
      )}
    </section>
  )
}
