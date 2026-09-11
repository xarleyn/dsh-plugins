/**
 * Content adapter suite (SPEC §15.2/§26): URL recognition, REST URL
 * construction, markup conversion, normalization output, seam fall-through,
 * and the full provider path over a local Jira-like REST fixture.
 */

import { afterEach, describe, expect, test } from 'vitest'
import { applyAdapter } from '../src/adapters/index.js'
import { extractIssueKey, fetchIssueMarkdown, issueApiUrl, wikiMarkupToMarkdown, adfToMarkdown } from '../src/adapters/jira.js'
import { contentApiUrl, contentLookupUrl, extractPageRef, fetchPageMarkdown, restPrefix, storageToMarkdown } from '../src/adapters/confluence.js'
import { resolveConfig } from '../src/config.js'
import { validateRule } from '../src/rule-validation.js'
import { fakeCredentials, configWith, fixtureRule, startFixture, type FixtureServer } from './helpers.js'
import { AuthenticatedFetchProvider } from '../src/provider.js'
import { WebError } from '@deepseek-ai/dsh-web'
import type { AdapterRequestContext } from '../src/adapters/index.js'
import type { ResolvedAdapter, ResolvedRule, AuthenticatedFetchRule } from '../src/types.js'
import type { PluginLogger } from '@yadsh/dsh-plugin-log'

/** A logger the audits can write into without any output. */
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

function adapterSettings(overrides: Partial<ResolvedAdapter> = {}): ResolvedAdapter {
  return { type: 'jira', jiraFlavor: 'server', includeComments: false, includeLinks: false, ...overrides }
}

function context(adapter: ResolvedAdapter, overrides: Partial<AdapterRequestContext> = {}): AdapterRequestContext {
  const rule = { adapter, source: { id: 'r' } } as unknown as ResolvedRule
  return {
    rule,
    rules: [rule],
    globals: { maxUrlLength: 2048, userAgent: 'test' },
    resolveSecrets: async () => ({}),
    ...overrides,
  }
}

describe('jira URL and REST URL construction', () => {
  test('extracts issue keys from browse and issues paths at any depth', () => {
    expect(extractIssueKey('/browse/MDC-123')).toBe('MDC-123')
    expect(extractIssueKey('/jira/browse/abc-9')).toBe('ABC-9')
    expect(extractIssueKey('/issues/EX-42/')).toBe('EX-42')
    expect(extractIssueKey('/display/DEV/Home')).toBeUndefined()
    expect(extractIssueKey('/browse/notakey')).toBeUndefined()
  })

  test('builds REST v2 URLs for server flavor with the field list', () => {
    const url = issueApiUrl('https://jira.corp', 'MDC-123', adapterSettings())
    expect(url.toString()).toBe('https://jira.corp/rest/api/2/issue/MDC-123?fields=summary%2Cstatus%2Cassignee%2Creporter%2Cpriority%2Clabels%2Ccomponents%2Ccreated%2Cupdated')
  })

  test('adds comment and link fields when enabled', () => {
    const url = issueApiUrl('https://jira.corp', 'MDC-123', adapterSettings({ includeComments: true, includeLinks: true }))
    expect(url.searchParams.get('fields')).toContain('comment')
    expect(url.searchParams.get('fields')).toContain('issuelinks')
  })

  test('cloud flavor uses REST v3', () => {
    const url = issueApiUrl('https://corp.atlassian.net', 'EX-1', adapterSettings({ jiraFlavor: 'cloud' }))
    expect(url.pathname).toBe('/rest/api/3/issue/EX-1')
  })
})

describe('jira wiki markup → markdown', () => {
  test('headings, lists, emphasis, code, quotes, and links convert', () => {
    const source = [
      'h2. Plan',
      '* first',
      '*# nested',
      '*bold* and _italic_ and {{mono}}',
      '[label|https://x]',
      'bq. quoted line',
      '{code:java}',
      'int x = 1;',
      '{code}',
    ].join('\n')
    const md = wikiMarkupToMarkdown(source)
    expect(md).toContain('### Plan')
    expect(md).toContain('- first')
    expect(md).toContain('1. nested')
    expect(md).toContain('**bold**')
    expect(md).toContain('*italic*')
    expect(md).toContain('`mono`')
    expect(md).toContain('[label](https://x)')
    expect(md).toContain('> quoted line')
    expect(md).toContain('```java')
    expect(md).toContain('int x = 1;')
  })

  test('wiki tables convert to pipe tables with separators', () => {
    const md = wikiMarkupToMarkdown('||Name||Value||\n|a|b|')
    expect(md.split('\n')).toEqual(['| Name | Value |', '| --- | --- |', '| a | b |'])
  })
})

describe('jira ADF → markdown (Cloud bodies)', () => {
  test('paragraphs, headings, lists, and code blocks convert', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'plain ' }, { type: 'text', text: 'bold', marks: [{ type: 'strong' }] }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Head' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
      ],
    }
    const md = adfToMarkdown(doc)
    expect(md).toContain('plain **bold**')
    expect(md).toContain('## Head')
    expect(md).toContain('- item')
    expect(md).toContain('```ts\nconst a = 1\n```')
  })

  test('links come from marks', () => {
    const md = adfToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x' } }] }] }] })
    expect(md).toContain('[docs](https://x)')
  })
})

describe('jira issue normalization', () => {
  const issuePayload = {
    key: 'MDC-123',
    fields: {
      summary: 'Fix the thing',
      status: { name: 'In Progress' },
      assignee: { displayName: 'Ada' },
      reporter: { displayName: 'Grace' },
      priority: { name: 'High' },
      labels: ['infra'],
      components: [{ name: 'core' }],
      created: '2026-01-02T10:00:00.000+0000',
      updated: '2026-02-03T11:00:00.000+0000',
      description: 'h3. Steps\n* do it',
    },
  }

  test('renders the field block and converted description', async () => {
    const { statusCode, markdown } = await fetchIssueMarkdown(
      new URL('https://jira.corp/browse/MDC-123'),
      adapterSettings(),
      async () => ({ statusCode: 200, data: issuePayload }),
    )
    expect(statusCode).toBe(200)
    expect(markdown).toContain('# MDC-123: Fix the thing')
    expect(markdown).toContain('- Status: In Progress')
    expect(markdown).toContain('- Assignee: Ada')
    expect(markdown).toContain('- Updated: 2026-02-03')
    expect(markdown).toContain('## Description')
    expect(markdown).toContain('### Steps')
    expect(markdown).toContain('- do it')
    expect(markdown).not.toContain('Comments')
  })

  test('comments and links render only when enabled', async () => {
    const payload = {
      ...issuePayload,
      fields: {
        ...issuePayload.fields,
        comment: { comments: [{ author: { displayName: 'Bob' }, created: '2026-02-04T00:00:00.000+0000', body: 'looks good' }] },
        issuelinks: [{ type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }, outwardIssue: { key: 'MDC-9' } }],
      },
    }
    const enabled = await fetchIssueMarkdown(new URL('https://jira.corp/browse/MDC-123'), adapterSettings({ includeComments: true, includeLinks: true }), async () => ({ statusCode: 200, data: payload }))
    expect(enabled.markdown).toContain('## Comments')
    expect(enabled.markdown).toContain('### Bob — 2026-02-04')
    expect(enabled.markdown).toContain('blocks [MDC-9]')
    const disabled = await fetchIssueMarkdown(new URL('https://jira.corp/browse/MDC-123'), adapterSettings(), async () => ({ statusCode: 200, data: payload }))
    expect(disabled.markdown).not.toContain('## Comments')
    expect(disabled.markdown).not.toContain('MDC-9')
  })

  test('non-2xx REST responses stay results with a short note', async () => {
    const { statusCode, markdown } = await fetchIssueMarkdown(new URL('https://jira.corp/browse/MDC-123'), adapterSettings(), async () => ({ statusCode: 404, data: {} }))
    expect(statusCode).toBe(404)
    expect(markdown).toContain('HTTP 404')
  })
})

describe('confluence recognition and REST URLs', () => {
  test('page-id paths and display paths are recognized', () => {
    expect(extractPageRef('/pages/123456')).toEqual({ id: '123456' })
    expect(extractPageRef('/wiki/spaces/DEV/pages/123456/Title')).toEqual({ id: '123456' })
    expect(extractPageRef('/display/DEV/Some+Title')).toEqual({ spaceKey: 'DEV', title: 'Some Title' })
    expect(extractPageRef('/login')).toBeUndefined()
  })

  test('REST prefix follows the /wiki (Cloud) convention', () => {
    expect(restPrefix('/wiki/spaces/DEV/pages/1/T')).toBe('/wiki/rest/api')
    expect(restPrefix('/display/DEV/T')).toBe('/rest/api')
  })

  test('direct content and lookup URLs carry the expansions', () => {
    expect(contentApiUrl('https://w.corp', '/rest/api', '7').pathname).toBe('/rest/api/content/7')
    expect(contentApiUrl('https://w.corp', '/rest/api', '7').searchParams.get('expand')).toBe('body.storage,space,version')
    const lookup = contentLookupUrl('https://w.corp', '/rest/api', 'DEV', 'T')
    expect(lookup.searchParams.get('spaceKey')).toBe('DEV')
    expect(lookup.searchParams.get('title')).toBe('T')
  })
})

describe('confluence storage → markdown', () => {
  test('paragraphs, headings, lists, tables, and entities convert', () => {
    const storage = [
      '<h1>Top</h1>',
      '<p>Alpha &amp; beta</p>',
      '<h2>Section</h2>',
      '<ul><li>one</li><li>two<ol><li>inner</li></ol></li></ul>',
      '<table><tbody><tr><th>H</th></tr><tr><td>v|1</td></tr></tbody></table>',
      '<blockquote><p>quoted</p></blockquote>',
      '<p><strong>b</strong> and <a href="https://x">link</a></p>',
    ].join('\n')
    const md = storageToMarkdown(storage)
    expect(md).toContain('# Top')
    expect(md).toContain('Alpha & beta')
    expect(md).toContain('## Section')
    expect(md).toContain('- one')
    expect(md).toContain('1. inner')
    expect(md).toContain('| H |')
    expect(md).toContain('v\\|1')
    expect(md).toContain('> quoted')
    expect(md).toContain('**b**')
    expect(md).toContain('[link](https://x)')
  })

  test('code macros render fenced with their language; unknown macros leave a placeholder', () => {
    const storage = [
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[let a = 1;]]></ac:plain-text-body></ac:structured-macro>',
      '<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">Green</ac:parameter></ac:structured-macro>',
    ].join('\n')
    const md = storageToMarkdown(storage)
    expect(md).toContain('```js\nlet a = 1;\n```')
    expect(md).toContain('[macro: status')
  })

  test('ac:link renders the link body or the referenced page title', () => {
    const withBody = storageToMarkdown('<ac:link><ac:link-body>Target</ac:link-body></ac:link>')
    expect(withBody).toContain('Target')
    const withRef = storageToMarkdown('<ac:link><ri:page ri:content-title="Other Page"/></ac:link>')
    expect(withRef).toContain('Other Page')
  })
})

describe('confluence page normalization', () => {
  const pagePayload = {
    id: '7',
    title: 'Runbook',
    space: { name: 'Operations' },
    version: { when: '2026-03-04T00:00:00.000Z' },
    body: { storage: { value: '<p>Hello world</p>' } },
  }

  test('direct fetch renders metadata plus converted storage body', async () => {
    const { markdown } = await fetchPageMarkdown(new URL('https://w.corp/pages/7'), adapterSettings({ type: 'confluence' }), async url => {
      expect(url.pathname).toBe('/rest/api/content/7')
      return { statusCode: 200, data: pagePayload }
    })
    expect(markdown).toContain('# Runbook')
    expect(markdown).toContain('- Space: Operations')
    expect(markdown).toContain('Hello world')
  })

  test('display URLs resolve through the title lookup envelope', async () => {
    const { markdown } = await fetchPageMarkdown(new URL('https://w.corp/display/OPS/Runbook'), adapterSettings({ type: 'confluence' }), async url => {
      expect(url.pathname).toBe('/rest/api/content')
      expect(url.searchParams.get('spaceKey')).toBe('OPS')
      return { statusCode: 200, data: { results: [pagePayload] } }
    })
    expect(markdown).toContain('# Runbook')
  })

  test('non-2xx REST responses stay results with a short note', async () => {
    const { statusCode, markdown } = await fetchPageMarkdown(new URL('https://w.corp/pages/7'), adapterSettings({ type: 'confluence' }), async () => ({ statusCode: 403, data: {} }))
    expect(statusCode).toBe(403)
    expect(markdown).toContain('HTTP 403')
  })
})

describe('adapter seam', () => {
  test('falls through for none adapters and unrecognized URLs', async () => {
    const none = await applyAdapter(new URL('https://jira.corp/browse/MDC-1'), context(adapterSettings({ type: 'none' })))
    expect(none).toBeUndefined()
    const unmapped = await applyAdapter(new URL('https://jira.corp/status'), context(adapterSettings()))
    expect(unmapped).toBeUndefined()
  })

  test('rejects non-JSON REST bodies with a structured error', async () => {
    const promise = applyAdapter(
      new URL('https://jira.corp/browse/MDC-1'),
      context(adapterSettings()),
      async () => ({ url: 'u', statusCode: 200, body: { kind: 'html', content: '<p>x</p>' }, truncated: false }),
    )
    await expect(promise).rejects.toMatchObject({ code: 'AUTH_FETCH_ADAPTER_FAILED' })
  })

  test('rejects malformed JSON with a structured error', async () => {
    const promise = applyAdapter(
      new URL('https://jira.corp/browse/MDC-1'),
      context(adapterSettings()),
      async () => ({ url: 'u', statusCode: 200, body: { kind: 'text', content: 'not-json' }, truncated: false }),
    )
    await expect(promise).rejects.toBeInstanceOf(WebError)
  })

  test('caps the generated text by maxBodyChars', async () => {
    const rule = { adapter: adapterSettings(), source: { id: 'r' }, limits: { maxBodyChars: 10 } } as unknown as ResolvedRule
    const result = await applyAdapter(
      new URL('https://jira.corp/browse/MDC-1'),
      { rule, rules: [rule], globals: { maxUrlLength: 2048, userAgent: 't' }, resolveSecrets: async () => ({}) },
      async () => ({ url: 'u', statusCode: 200, body: { kind: 'text', content: JSON.stringify(issuePayloadOf(100)) }, truncated: false }),
    )
    expect(result?.truncated).toBe(true)
    expect(result?.body.content.length).toBe(10)
  })

  function issuePayloadOf(summaryLength: number): unknown {
    return { key: 'MDC-1', fields: { summary: 'x'.repeat(summaryLength) } }
  }
})

describe('provider end-to-end with a Jira adapter over a fixture', () => {
  let server: FixtureServer | undefined

  afterEach(async () => {
    if (server !== undefined) await server.close()
    server = undefined
  })

  test('a browse URL is served from the REST fixture as normalized text', async () => {
    server = await startFixture({}, {
      body: JSON.stringify({
        key: 'MDC-1',
        fields: { summary: 'Fixture issue', status: { name: 'Open' }, description: 'plain body' },
      }),
    })
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, {
      adapter: { type: 'jira' },
      match: { schemes: ['http'], hosts: ['127.0.0.1'], ports: [server.port], allowPaths: ['/browse/**', '/rest/api/**'] },
    })
    const credentials = fakeCredentials({ TEST_TOKEN: 'secret' })
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials,
      logger: silentLogger(),
    })
    const result = await provider.fetch({ url: `${server.origin}/browse/MDC-1` })
    expect(result.statusCode).toBe(200)
    expect(result.body.kind).toBe('text')
    expect(result.body.content).toContain('# MDC-1: Fixture issue')
    expect(result.body.content).toContain('plain body')
    expect(server.requests.map(request => request.url)).toEqual(['/rest/api/2/issue/MDC-1?fields=summary%2Cstatus%2Cassignee%2Creporter%2Cpriority%2Clabels%2Ccomponents%2Ccreated%2Cupdated'])
  })

  test('an adapter URL the adapter cannot map falls through to raw transport', async () => {
    server = await startFixture({ '/open': { body: '<html><body>hello</body></html>', headers: { 'content-type': 'text/html; charset=utf-8' } } })
    const rule: AuthenticatedFetchRule = fixtureRule(server.origin, { adapter: { type: 'jira' } })
    const provider = new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: 'secret' }),
      logger: silentLogger(),
    })
    const result = await provider.fetch({ url: `${server.origin}/open` })
    expect(result.body.kind).toBe('html')
    expect(result.body.content).toContain('hello')
  })
})

describe('adapter configuration', () => {
  test('defaults resolve to none with server flavor', () => {
    const config = resolveConfig(configWith([fixtureRule('http://127.0.0.1:1')]))
    expect(config.rules[0]?.adapter).toEqual({ type: 'none', jiraFlavor: 'server', includeComments: false, includeLinks: false })
  })

  test('adapter settings resolve with defaults applied', () => {
    const config = resolveConfig(configWith([fixtureRule('http://127.0.0.1:1', { adapter: { type: 'jira', includeComments: true } })]))
    expect(config.rules[0]?.adapter).toEqual({ type: 'jira', jiraFlavor: 'server', includeComments: true, includeLinks: false })
  })

  test('unknown adapter types and flavors are rejected', () => {
    const broken = fixtureRule('http://127.0.0.1:1', { adapter: { type: 'wiki' as never } })
    const errors = validateRule(broken, 0)
    expect(errors.some((error: string) => error.includes('adapter type'))).toBe(true)
    const badFlavor = fixtureRule('http://127.0.0.1:1', { adapter: { type: 'jira', jiraFlavor: 'solaris' as never } })
    expect(validateRule(badFlavor, 0).some((error: string) => error.includes('jiraFlavor'))).toBe(true)
  })
})
