/**
 * Test helpers: local fixture HTTP servers and a scripted credential resolver.
 * No real network is touched — everything listens on loopback.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthenticatedFetchRule, WebFetchAuthConfig } from '../src/types.js'

export interface FixtureServer {
  url: string
  origin: string
  port: number
  close(): Promise<void>
  /** Requests received so far, as seen by the server (headers included). */
  requests: Array<{ url: string; headers: http.IncomingHttpHeaders }>
}

export interface FixtureRoute {
  /** Reply with a JSON-ish body and status. */
  status?: number
  headers?: Record<string, string>
  body?: string
  /** Redirect instead of answering: `location` + status (301/302/...). */
  redirectStatus?: number
  redirectLocation?: string
  /** Sleep before answering (timeout tests). */
  delayMs?: number
  /** Whether the route requires the Authorization header to be present. */
  requireBearer?: string
}

export async function startFixture(routes: Record<string, FixtureRoute> = {}, defaults?: Partial<FixtureRoute>): Promise<FixtureServer> {
  const server = http.createServer((request, response) => {
    const path = request.url ?? '/'
    fixtureServer.requests.push({ url: path, headers: request.headers })
    const route = routes[path] ?? defaults ?? {}
    const respond = (): void => {
      if (route.redirectStatus !== undefined) {
        response.writeHead(route.redirectStatus, { location: route.redirectLocation ?? '/', ...(route.headers ?? {}) })
        response.end()
        return
      }
      const body = route.body ?? '{"ok":true}'
      response.writeHead(route.status ?? 200, {
        'content-type': route.headers?.['content-type'] ?? 'application/json',
        ...(route.headers ?? {}),
      })
      response.end(body)
    }
    if (route.delayMs !== undefined) setTimeout(respond, route.delayMs)
    else respond()
  })
  const fixtureServer = server as http.Server & { requests: FixtureServer['requests'] }
  fixtureServer.requests = []
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  return {
    url: `${origin}`,
    origin,
    port: address.port,
    requests: fixtureServer.requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined || error === null ? resolve() : reject(error)))
      })
    },
  }
}

/** A credential resolver with hardcoded values; records every lookup. */
export function fakeCredentials(values: Record<string, string>): {
  resolve: (ref: string) => Promise<string | undefined>
  describe: (ref: string) => Promise<{ configured: boolean; writable: boolean } | undefined>
  lookups: string[]
} {
  const lookups: string[] = []
  return {
    lookups,
    async resolve(ref: string) {
      lookups.push(ref)
      const value = values[ref]
      return value === undefined ? undefined : value
    },
    async describe(ref: string) {
      return { configured: values[ref] !== undefined, writable: true }
    },
  }
}

/** Build a rule aimed at a loopback fixture (allowLoopback on by default). */
export function fixtureRule(origin: string, overrides: Partial<AuthenticatedFetchRule> = {}): AuthenticatedFetchRule {
  const port = Number(new URL(origin).port)
  return {
    id: 'test-rule',
    name: 'Test rule',
    enabled: true,
    match: {
      schemes: ['http'],
      hosts: ['127.0.0.1'],
      ports: [port],
      allowPaths: ['/secure/**', '/redirect/**', '/open'],
    },
    auth: { type: 'bearer', credential: 'TEST_TOKEN' },
    networkPolicy: { allowLoopback: true },
    redirects: { mode: 'same-origin', maxRedirects: 3 },
    ...overrides,
  }
}

export function configWith(rules: AuthenticatedFetchRule[], overrides: Partial<WebFetchAuthConfig> = {}): WebFetchAuthConfig {
  return {
    enabled: true,
    rules,
    audit: { enabled: false },
    ...overrides,
  }
}
