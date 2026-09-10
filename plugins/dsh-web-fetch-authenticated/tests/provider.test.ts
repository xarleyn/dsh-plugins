/**
 * Integration suite over local fixture servers (SPEC §26.3): Bearer/Basic/API-key
 * auth, same-origin redirects, size/timeout limits, non-2xx-as-result, and the
 * sanitized tester/diagnose reports.
 */

import { afterAll, describe, expect, test } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { AuthenticatedFetchProvider } from '../src/provider.js'
import { testRule, diagnose } from '../src/testing.js'
import { configWith, fakeCredentials, fixtureRule, startFixture, type FixtureServer } from './helpers.js'
import type { PluginLogger } from '@yadsh/dsh-plugin-log'
import type { WebFetchAuthConfig } from '../src/types.js'

const SECRET = 'fixture-secret-token'

function silentLogger(): PluginLogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: 'error',
    setLevel: () => {},
  } as unknown as PluginLogger
}

function newProvider(config: WebFetchAuthConfig): { provider: AuthenticatedFetchProvider; lookups: string[] } {
  const credentials = fakeCredentials({ TEST_TOKEN: SECRET, TEST_PASSWORD: SECRET })
  const provider = new AuthenticatedFetchProvider({
    configSource: () => config,
    credentials,
    logger: silentLogger(),
  })
  return { provider, lookups: credentials.lookups }
}

async function expectCode(code: string, run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WebError)
    expect((error as WebError).code, String(error)).toBe(code)
    return String(error)
  }
  throw new Error(`expected ${code}`)
}

const servers: FixtureServer[] = []
afterAll(async () => {
  await Promise.all(servers.map(server => server.close()))
})
async function track(server: FixtureServer): Promise<FixtureServer> {
  servers.push(server)
  return server
}

describe('authentication injection', () => {
  test('bearer token reaches the fixture and the body comes back', async () => {
    const server = await track(await startFixture({
      '/secure/data': { body: 'authed-body' },
    }))
    const config = configWith([fixtureRule(server.origin)])
    const { provider } = newProvider(config)
    const result = await provider.fetch({ url: `${server.origin}/secure/data` })
    expect(result.statusCode).toBe(200)
    expect(result.body).toEqual({ kind: 'text', content: 'authed-body' })
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`)
  })

  test('basic auth builds the standard header from username + password credential', async () => {
    const server = await track(await startFixture({ '/secure/data': {} }))
    const rule = fixtureRule(server.origin, {
      auth: { type: 'basic', username: 'svc-account', passwordCredential: 'TEST_PASSWORD' },
    })
    const { provider } = newProvider(configWith([rule]))
    const result = await provider.fetch({ url: `${server.origin}/secure/data` })
    expect(result.statusCode).toBe(200)
    const expected = Buffer.from(`svc-account:${SECRET}`, 'utf8').toString('base64')
    expect(server.requests[0]?.headers.authorization).toBe(`Basic ${expected}`)
  })

  test('api key header uses the configured name and prefix', async () => {
    const server = await track(await startFixture({ '/secure/data': {} }))
    const rule = fixtureRule(server.origin, {
      auth: { type: 'header', headerName: 'X-API-Key', credential: 'TEST_TOKEN', prefix: 'ApiKey ' },
    })
    const { provider } = newProvider(configWith([rule]))
    await provider.fetch({ url: `${server.origin}/secure/data` })
    expect(server.requests[0]?.headers['x-api-key']).toBe(`ApiKey ${SECRET}`)
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
  })

  test('auth type none sends no credential headers', async () => {
    const server = await track(await startFixture({ '/open': {} }))
    const rule = fixtureRule(server.origin, { auth: { type: 'none' } })
    const { provider } = newProvider(configWith([rule]))
    await provider.fetch({ url: `${server.origin}/open` })
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
  })

  test('missing credential rejects with AUTH_FETCH_CREDENTIAL_MISSING per request', async () => {
    const server = await track(await startFixture({ '/secure/data': {} }))
    const rule = fixtureRule(server.origin, { auth: { type: 'bearer', credential: 'NOT_CONFIGURED' } })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_CREDENTIAL_MISSING', () => provider.fetch({ url: `${server.origin}/secure/data` }))
    expect(server.requests).toHaveLength(0)
  })
})

describe('matching hygiene over HTTP', () => {
  test('denyPaths subtract from allowPaths', async () => {
    const server = await track(await startFixture({
      '/secure/ok': { body: 'ok' },
      '/secure/private/config': { body: 'nope' },
    }))
    const rule = fixtureRule(server.origin, {
      match: {
        schemes: ['http'],
        hosts: ['127.0.0.1'],
        ports: [server.port],
        allowPaths: ['/secure/**'],
        denyPaths: ['/secure/private/**'],
      },
    })
    const { provider } = newProvider(configWith([rule]))
    const ok = await provider.fetch({ url: `${server.origin}/secure/ok` })
    expect(ok.statusCode).toBe(200)
    await expectCode('AUTH_FETCH_NO_MATCHING_RULE', () => provider.fetch({ url: `${server.origin}/secure/private/config` }))
  })

  test('ports outside the rule do not match', async () => {
    const rule = fixtureRule('http://127.0.0.1:1', { match: { schemes: ['http'], hosts: ['127.0.0.1'], ports: [1] } })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_NO_MATCHING_RULE', () => provider.fetch({ url: `http://127.0.0.1:${String(1 + 1)}/open` }))
  })

  test('non-2xx responses are results, not errors', async () => {
    const server = await track(await startFixture({ '/secure/gone': { status: 404, body: 'missing' } }))
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]))
    const result = await provider.fetch({ url: `${server.origin}/secure/gone` })
    expect(result.statusCode).toBe(404)
    expect(result.body).toEqual({ kind: 'text', content: 'missing' })
  })

  test('unsupported binary content types reject', async () => {
    const server = await track(await startFixture({
      '/secure/blob': { headers: { 'content-type': 'application/octet-stream' }, body: 'bin' },
    }))
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]))
    await expectCode('AUTH_FETCH_UNSUPPORTED_CONTENT', () => provider.fetch({ url: `${server.origin}/secure/blob` }))
  })
})

describe('redirect policy', () => {
  test('same-origin redirect keeps auth and follows', async () => {
    const server = await track(await startFixture({
      '/redirect/start': { redirectStatus: 302, redirectLocation: '/secure/final' },
      '/secure/final': { body: 'final-body' },
    }))
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]))
    const result = await provider.fetch({ url: `${server.origin}/redirect/start` })
    expect(result.body).toEqual({ kind: 'text', content: 'final-body' })
    expect(result.url).toBe(`${server.origin}/secure/final`)
    expect(server.requests[1]?.headers.authorization).toBe(`Bearer ${SECRET}`)
  })

  test('cross-origin redirect is denied with the auth never sent to the target', async () => {
    const other = await track(await startFixture({ '/steal': { body: 'stolen' } }))
    const server = await track(await startFixture({
      '/redirect/start': { redirectStatus: 302, redirectLocation: `${other.origin}/steal` },
    }))
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]))
    const error = await expectCode('AUTH_FETCH_REDIRECT_DENIED', () => provider.fetch({ url: `${server.origin}/redirect/start` }))
    expect(error).toContain(other.origin)
    expect(other.requests).toHaveLength(0)
  })

  test('redirect to a path outside allowPaths is denied (re-match of the same rule)', async () => {
    const server = await track(await startFixture({
      '/redirect/start': { redirectStatus: 302, redirectLocation: '/elsewhere' },
      '/elsewhere': { body: 'leak' },
    }))
    const { provider } = newProvider(configWith([fixtureRule(server.origin)]))
    await expectCode('AUTH_FETCH_REDIRECT_DENIED', () => provider.fetch({ url: `${server.origin}/redirect/start` }))
    expect(server.requests).toHaveLength(1)
  })

  test('redirect budget is enforced', async () => {
    const server = await track(await startFixture({
      '/redirect/1': { redirectStatus: 302, redirectLocation: '/redirect/2' },
      '/redirect/2': { redirectStatus: 302, redirectLocation: '/redirect/3' },
      '/redirect/3': { redirectStatus: 302, redirectLocation: '/redirect/4' },
      '/redirect/4': { redirectStatus: 302, redirectLocation: '/redirect/5' },
      '/redirect/5': { body: 'far' },
    }, { redirectStatus: 302, redirectLocation: '/redirect/loop' }))
    const rule = fixtureRule(server.origin, {
      match: { schemes: ['http'], hosts: ['127.0.0.1'], ports: [server.port], allowPaths: ['/redirect/**'] },
      redirects: { mode: 'same-origin', maxRedirects: 2 },
    })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_REDIRECT_DENIED', () => provider.fetch({ url: `${server.origin}/redirect/1` }))
  })

  test('allowlist redirect to a rule-authorized origin switches rules with their own credential', async () => {
    const target = await track(await startFixture({ '/secure/landing': { body: 'landing' } }))
    const server = await track(await startFixture({
      '/redirect/out': { redirectStatus: 302, redirectLocation: `${target.origin}/secure/landing` },
    }))
    const originRule = fixtureRule(server.origin, {
      id: 'origin-rule',
      redirects: {
        mode: 'allowlist',
        maxRedirects: 3,
        allowedOrigins: [target.origin],
      },
    })
    const targetRule = fixtureRule(target.origin, { id: 'target-rule', auth: { type: 'bearer', credential: 'OTHER_TOKEN' } })
    const credentials = fakeCredentials({ TEST_TOKEN: SECRET, OTHER_TOKEN: 'target-secret' })
    const config = configWith([originRule, targetRule])
    const provider = new AuthenticatedFetchProvider({
      configSource: () => config,
      credentials,
      logger: silentLogger(),
    })
    const result = await provider.fetch({ url: `${server.origin}/redirect/out` })
    expect(result.body).toEqual({ kind: 'text', content: 'landing' })
    // The target request must carry the TARGET rule's credential (invariant 4):
    // a credential never crosses into an origin its own rule does not authorize.
    expect(target.requests[0]?.headers.authorization).toBe('Bearer target-secret')
    expect(JSON.stringify(server.requests[0]?.headers)).toContain(SECRET)
  })

  test('mode none denies any redirect', async () => {
    const server = await track(await startFixture({
      '/redirect/start': { redirectStatus: 302, redirectLocation: '/open' },
    }))
    const rule = fixtureRule(server.origin, { redirects: { mode: 'none', maxRedirects: 3 } })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_REDIRECT_DENIED', () => provider.fetch({ url: `${server.origin}/redirect/start` }))
  })
})

describe('limits', () => {
  test('content-length over the cap rejects before reading', async () => {
    const server = await track(await startFixture({
      '/secure/big': { headers: { 'content-length': String(1024 * 1024) }, body: 'x' },
    }))
    const rule = fixtureRule(server.origin, { limits: { maxResponseBytes: 1024, timeoutMs: 5000 } })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_RESPONSE_TOO_LARGE', () => provider.fetch({ url: `${server.origin}/secure/big` }))
  })

  test('streams growing past the cap are truncated, not failed', async () => {
    const server = await track(await startFixture({
      '/secure/stream': { body: 'y'.repeat(4096), headers: { 'content-type': 'text/plain' } },
    }))
    const rule = fixtureRule(server.origin, { limits: { maxResponseBytes: 1024, maxBodyChars: 100000, timeoutMs: 5000 } })
    const { provider } = newProvider(configWith([rule]))
    const result = await provider.fetch({ url: `${server.origin}/secure/stream` })
    expect(result.truncated).toBe(true)
    expect(result.body.content).toHaveLength(1024)
  })

  test('timeout aborts with AUTH_FETCH_TIMEOUT', async () => {
    const server = await track(await startFixture({
      '/secure/slow': { delayMs: 2000, body: 'late' },
    }))
    const rule = fixtureRule(server.origin, { limits: { timeoutMs: 150 } })
    const { provider } = newProvider(configWith([rule]))
    await expectCode('AUTH_FETCH_TIMEOUT', () => provider.fetch({ url: `${server.origin}/secure/slow` }))
  })
})

describe('provider availability and error codes', () => {
  test('disabled config reports unavailable and fetch fails closed', async () => {
    const rule = fixtureRule('http://127.0.0.1:1')
    const config = configWith([rule], { enabled: false })
    const { provider } = newProvider(config)
    expect(provider.available()).toBe(false)
    await expectCode('AUTH_FETCH_RULE_DISABLED', () => provider.fetch({ url: 'http://127.0.0.1:1/open' }))
  })

  test('available() stays true with rules present but a missing credential (fails per request)', () => {
    const rule = fixtureRule('http://127.0.0.1:1', { auth: { type: 'bearer', credential: 'ABSENT' } })
    const { provider } = newProvider(configWith([rule]))
    expect(provider.available()).toBe(true)
  })
})

describe('tester and diagnostics (UI API sanitization)', () => {
  test('testRule reports success without secrets and records the outcome', async () => {
    const server = await track(await startFixture({
      '/secure/data': { body: 'hello body with Bearer abcdef123456 inside' },
    }))
    const credentials = fakeCredentials({ TEST_TOKEN: SECRET })
    const config = configWith([fixtureRule(server.origin, { testUrl: `${server.origin}/secure/data` })])
    const report = await testRule({ configSource: () => config, credentials }, 'test-rule')
    expect(report.ok).toBe(true)
    expect(report.statusCode).toBe(200)
    expect(report.authApplied).toBe(true)
    expect(report.credentialState?.configured).toBe(true)
    // Preview is sanitized: the fake bearer-looking run is scrubbed.
    expect(report.preview).not.toContain('abcdef123456')
    expect(JSON.stringify(report)).not.toContain(SECRET)
  })

  test('testRule reports network denial for private targets without a request', async () => {
    const server = await track(await startFixture({}))
    const rule = fixtureRule(server.origin, { networkPolicy: { allowLoopback: false } })
    const config = configWith([rule])
    const report = await testRule(
      { configSource: () => config, credentials: fakeCredentials({ TEST_TOKEN: SECRET }) },
      'test-rule',
      `${server.origin}/secure/data`,
    )
    expect(report.ok).toBe(false)
    expect(report.outcome).toBe('AUTH_FETCH_NETWORK_DENIED')
    expect(server.requests).toHaveLength(0)
  })

  test('diagnose classifies DNS and match without sending anything', async () => {
    const server = await track(await startFixture({}))
    const config = configWith([fixtureRule(server.origin)])
    const report = await diagnose({ configSource: () => config, credentials: fakeCredentials({}) }, `${server.origin}/secure/anything`)
    expect(report.match.ruleId).toBe('test-rule')
    expect(report.networkAllowed).toBe(true)
    expect(report.addresses[0]?.networkClass).toBe('loopback')
    expect(server.requests).toHaveLength(0)
  })

  test('diagnose reports unmatched URLs', async () => {
    const config = configWith([fixtureRule('http://127.0.0.1:1')])
    const report = await diagnose({ configSource: () => config, credentials: fakeCredentials({}) }, 'https://jira.example.corp/browse/X')
    expect(report.match.ruleId).toBeUndefined()
    expect(report.networkAllowed).toBe(false)
  })
})
