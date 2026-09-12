/**
 * Jira content adapter (SPEC §15.2): recognize `/browse/<ISSUE-KEY>` style
 * URLs, fetch the issue through the Jira REST API with the SAME authenticated
 * transport (so network policy, credentials, and limits apply unchanged), and
 * normalize the response into compact Markdown text — one dense block of the
 * fields the model actually needs instead of a page of application chrome.
 * Server/Data Center issues carry wiki-markup descriptions; Cloud issues
 * carry Atlassian Document Format bodies; both convert to Markdown here.
 * @module adapters/jira
 */

import type { ResolvedAdapter, ResolvedRule } from '../types.js'
import * as errors from '../errors.js'
import type { ResolvedAuthSecrets, } from '../auth/index.js'
import type { TransportGlobals } from '../transport/fetch.js'

/** REST JSON payload the adapter consumes. */
export type FetchJson = (url: URL) => Promise<{ statusCode: number; data: unknown }>

/** Everything an adapter needs beyond the URL; mirrors the transport options. */
export interface AdapterRequestContext {
  readonly rule: ResolvedRule
  readonly globals: TransportGlobals
  readonly resolveSecrets: (rule: ResolvedRule) => Promise<ResolvedAuthSecrets>
  readonly signal?: AbortSignal
}

/** Jira issue keys: two-plus letters, then digits (`MDC-123`, `ABC1-4`). */
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/u

/**
 * Extract an issue key from a URL path. Recognizes `/browse/KEY` at any depth
 * (deployments under `/jira/browse/…`) and `/issues/KEY`. Returns `undefined`
 * for URLs the adapter cannot map, so the caller falls back to raw HTML.
 */
export function extractIssueKey(pathname: string): string | undefined {
  for (const segment of pathname.split('/')) {
    if (segment.length > 0 && ISSUE_KEY_PATTERN.test(segment.toUpperCase()) && segment.includes('-')) {
      return segment.toUpperCase()
    }
  }
  return undefined
}

/** The REST fields a normalized issue text uses; `comment` only when enabled. */
function fieldList(adapter: ResolvedAdapter): string {
  const fields = ['summary', 'status', 'assignee', 'reporter', 'priority', 'labels', 'components', 'created', 'updated']
  if (adapter.includeLinks) fields.push('issuelinks')
  if (adapter.includeComments) fields.push('comment')
  return fields.join(',')
}

/** Build the REST issue URL for the configured flavor. */
export function issueApiUrl(origin: string, key: string, adapter: ResolvedAdapter, includeQuery = true): URL {
  const path = adapter.jiraFlavor === 'cloud' ? `/rest/api/3/issue/${key}` : `/rest/api/2/issue/${key}`
  const url = new URL(path, origin)
  if (includeQuery) url.searchParams.set('fields', fieldList(adapter))
  return url
}

/** REST paging path of the issue's comments, used by the tester's diagnostics. */
export function commentApiPath(key: string, adapter: ResolvedAdapter): string {
  return adapter.jiraFlavor === 'cloud' ? `/rest/api/3/issue/${key}/comment` : `/rest/api/2/issue/${key}/comment`
}

interface JiraUser {
  readonly displayName?: unknown
  readonly name?: unknown
  readonly emailAddress?: unknown
}

interface JiraIssueFields {
  readonly summary?: unknown
  readonly description?: unknown
  readonly status?: { readonly name?: unknown } | undefined
  readonly assignee?: JiraUser | null | undefined
  readonly reporter?: JiraUser | null | undefined
  readonly priority?: { readonly name?: unknown } | undefined
  readonly labels?: unknown
  readonly components?: unknown
  readonly created?: unknown
  readonly updated?: unknown
  readonly issuelinks?: unknown
  readonly comment?: unknown
}

function userName(user: JiraUser | null | undefined): string | undefined {
  if (user === null || user === undefined) return undefined
  for (const value of [user.displayName, user.name, user.emailAddress]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function fieldName(field: { readonly name?: unknown } | null | undefined): string | undefined {
  const name = field === null || field === undefined ? undefined : field.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/** Fetch a Jira issue and normalize it into Markdown text (SPEC §15.2). */
export async function fetchIssueMarkdown(
  requestUrl: URL,
  adapter: ResolvedAdapter,
  fetchJson: FetchJson,
): Promise<{ statusCode: number; markdown: string }> {
  const key = extractIssueKey(requestUrl.pathname)
  if (key === undefined) throw errors.adapterFailed(`URL path "${requestUrl.pathname}" does not contain a Jira issue key`)
  const apiUrl = issueApiUrl(requestUrl.origin, key, adapter)
  const response = await fetchJson(apiUrl)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Non-2xx stays a RESULT (the seam contract): the model sees why the
    // REST fetch did not yield an issue, never a thrown half-state.
    return {
      statusCode: response.statusCode,
      markdown: `[Jira] The Jira REST API returned HTTP ${response.statusCode} for issue ${key} at ${apiUrl.pathname}.`,
    }
  }
  const issue = asIssue(response.data, apiUrl.pathname)
  return { statusCode: response.statusCode, markdown: renderIssue(key, issue, adapter) }
}

function asIssue(data: unknown, path: string): { key?: string; fields: JiraIssueFields } {
  if (typeof data !== 'object' || data === null) {
    throw errors.adapterFailed(`Jira REST response at ${path} is not a JSON object`)
  }
  const record = data as { key?: unknown; fields?: unknown }
  if (typeof record.fields !== 'object' || record.fields === null) {
    throw errors.adapterFailed(`Jira REST response at ${path} has no fields object`)
  }
  return {
    ...(typeof record.key === 'string' ? { key: record.key } : {}),
    fields: record.fields as JiraIssueFields,
  }
}

function renderIssue(key: string, issue: { key?: string; fields: JiraIssueFields }, adapter: ResolvedAdapter): string {
  const fields = issue.fields
  const lines: string[] = []
  const summary = typeof fields.summary === 'string' ? fields.summary : ''
  lines.push(`# ${issue.key ?? key}${summary.length > 0 ? `: ${summary}` : ''}`)
  lines.push('')
  const facts: string[] = []
  const status = fieldName(fields.status)
  if (status !== undefined) facts.push(`Status: ${status}`)
  const assignee = userName(fields.assignee)
  if (assignee !== undefined) facts.push(`Assignee: ${assignee}`)
  const reporter = userName(fields.reporter)
  if (reporter !== undefined) facts.push(`Reporter: ${reporter}`)
  const priority = fieldName(fields.priority)
  if (priority !== undefined) facts.push(`Priority: ${priority}`)
  if (Array.isArray(fields.labels) && fields.labels.length > 0) {
    facts.push(`Labels: ${fields.labels.filter((label): label is string => typeof label === 'string').join(', ')}`)
  }
  if (Array.isArray(fields.components) && fields.components.length > 0) {
    const names = fields.components
      .map(component => (typeof component === 'object' && component !== null ? (component as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === 'string')
    if (names.length > 0) facts.push(`Components: ${names.join(', ')}`)
  }
  if (typeof fields.created === 'string') facts.push(`Created: ${fields.created.slice(0, 10)}`)
  if (typeof fields.updated === 'string') facts.push(`Updated: ${fields.updated.slice(0, 10)}`)
  if (facts.length > 0) {
    for (const fact of facts) lines.push(`- ${fact}`)
    lines.push('')
  }
  if (adapter.includeLinks) {
    const links = renderIssueLinks(fields.issuelinks)
    if (links.length > 0) {
      lines.push('## Issue links')
      lines.push(...links)
      lines.push('')
    }
  }
  const description = renderDescription(fields.description)
  if (description.length > 0) {
    lines.push('## Description')
    lines.push(description)
    lines.push('')
  }
  if (adapter.includeComments) {
    const comments = renderComments(fields.comment)
    if (comments.length > 0) {
      lines.push('## Comments')
      lines.push(...comments)
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd()
}

function renderIssueLinks(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  const out: string[] = []
  for (const link of links) {
    if (typeof link !== 'object' || link === null) continue
    const record = link as { type?: { name?: unknown; inward?: unknown; outward?: unknown }; inwardIssue?: { key?: unknown }; outwardIssue?: { key?: unknown } }
    const type = record.type
    if (type === undefined || typeof type !== 'object') continue
    if (record.outwardIssue !== undefined && typeof type.outward === 'string') {
      const target = (record.outwardIssue as { key?: unknown }).key
      if (typeof target === 'string') out.push(`- ${type.outward} [${target}]`)
    }
    if (record.inwardIssue !== undefined && typeof type.inward === 'string') {
      const target = (record.inwardIssue as { key?: unknown }).key
      if (typeof target === 'string') out.push(`- ${type.inward} [${target}]`)
    }
  }
  return out
}

/** Convert a description body (wiki markup or ADF) into Markdown. */
export function renderDescription(body: unknown): string {
  if (typeof body === 'string') return wikiMarkupToMarkdown(body)
  if (body === null || body === undefined) return ''
  if (typeof body === 'object') return adfToMarkdown(body)
  return ''
}

interface JiraComment {
  readonly author?: JiraUser | undefined
  readonly created?: unknown
  readonly body?: unknown
}

function renderComments(comment: unknown): string[] {
  if (typeof comment !== 'object' || comment === null) return []
  const comments = (comment as { comments?: unknown }).comments
  if (!Array.isArray(comments)) return []
  const out: string[] = []
  for (const entry of comments) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as JiraComment
    const author = userName(record.author) ?? 'unknown'
    const date = typeof record.created === 'string' ? record.created.slice(0, 10) : ''
    const body = renderDescription(record.body)
    out.push(`### ${author}${date.length > 0 ? ` — ${date}` : ''}`)
    out.push(body.length > 0 ? body : '_empty_')
    out.push('')
  }
  return out
}

// ---- Jira wiki markup → Markdown (Server/DC descriptions and comments) ----

/**
 * Convert Jira wiki markup to Markdown. Handles the heading, list, table,
 * block, and code constructs that occur in issue descriptions; inline markup
 * converts conservatively and unknown macros pass through as text.
 */
export function wikiMarkupToMarkdown(source: string): string {
  if (source.trim().length === 0) return ''
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const out: string[] = []
  let inCode: { tag: string } | undefined
  let inQuote = false
  let tableRows: string[] | undefined
  const flushTable = (): void => {
    if (tableRows === undefined) return
    const rows = tableRows.map(row => row.split('|').slice(1, -1))
    const width = Math.max(...rows.map(row => row.length), 1)
    const emit = (cells: string[]): string => `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? '').trim()).join(' | ')} |`
    for (const [index, cells] of rows.entries()) {
      out.push(emit(cells))
      if (index === 0) out.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
    }
    tableRows = undefined
  }
  const closeQuote = (): void => {
    if (inQuote) {
      inQuote = false
      out.push('')
    }
  }

  for (const line of lines) {
    if (inCode !== undefined) {
      if (line.trim() === `{${inCode.tag}}`) {
        out.push('```')
        inCode = undefined
      } else {
        out.push(line)
      }
      continue
    }
    const fence = /^\{(code|noformat)(?::([^}]*))?\}$/u.exec(line.trim())
    if (fence !== null && fence[1] !== undefined) {
      flushTable()
      closeQuote()
      const tag = fence[1]
      const params = fence[2] ?? ''
      inCode = { tag }
      const lang = tag === 'code' ? params.split('|')[0]?.replace(/^lang/i, '') ?? '' : ''
      out.push(lang.length > 0 ? '```' + lang : '```')
      continue
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('||') && trimmed.endsWith('||')) {
      tableRows = [`|${trimmed.slice(2, -2).replace(/\|\|/gu, '|')}|`]
      continue
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableRows = tableRows ?? []
      tableRows.push(`|${trimmed.slice(1, -1)}|`)
      continue
    }
    flushTable()
    if (trimmed.length === 0) {
      closeQuote()
      out.push('')
      continue
    }
    const heading = /^h([1-6])\.\s+(.*)$/u.exec(trimmed)
    if (heading !== null) {
      closeQuote()
      const level = Math.min(Number(heading[1] ?? '1') + 1, 6)
      out.push(`${'#'.repeat(level)} ${heading[2] ?? ''}`)
      continue
    }
    if (trimmed === '----') {
      closeQuote()
      out.push('---')
      continue
    }
    if (trimmed.startsWith('bq. ')) {
      if (!inQuote) inQuote = true
      out.push(`> ${trimmed.slice(4)}`)
      continue
    }
    if (trimmed === '{quote}') {
      closeQuote()
      inQuote = true
      continue
    }
    const listMatch = /^([*#]+)\s+(.*)$/u.exec(trimmed)
    if (listMatch !== null) {
      const depth = (listMatch[1] ?? '').length - 1
      const indent = '  '.repeat(depth)
      const bullet = (listMatch[1] ?? '').endsWith('#') ? '1.' : '-'
      out.push(`${indent}${bullet} ${listMatch[2] ?? ''}`)
      continue
    }
    if (inQuote) out.push(`> ${trimmed}`)
    else out.push(wikiInlineToMarkdown(trimmed))
  }
  flushTable()
  closeQuote()
  return out.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

/** Convert inline wiki markup (bold, italic, code, links) to Markdown. */
function isBareUrl(text: string): boolean {
  return /^https?:\/\//iu.test(text.trim())
}

function wikiInlineToMarkdown(text: string): string {
  let out = text
  // One pass over wiki links so later inline rules cannot re-match converted
  // markdown brackets: `[label|url]` → `[label](url)`, bare `[url]` → autolink.
  out = out.replace(/\[([^\]]+)\]/gu, (match, inner: string) => {
    const pipe = inner.indexOf('|')
    if (pipe >= 0) {
      const label = inner.slice(0, pipe).trim()
      const target = inner.slice(pipe + 1).trim()
      return label.length > 0 ? `[${label}](${target})` : `<${target}>`
    }
    return isBareUrl(inner) ? `<${inner.trim()}>` : match
  })
  out = out.replace(/\{color:[^}]*\}/gu, '').replace(/\{color\}/gu, '')
  out = out.replace(/!([^!\s]+)!/gu, '`$1`')
  out = out.replace(/\{\{([^}]+)\}\}/gu, '`$1`')
  out = out.replace(/\{([^{}:]+)[^{}]*\}/gu, '')
  out = out.replace(/\*\*([^*]+)\*\*/gu, '**$1**')
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/gu, '$1**$2**')
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/gu, '$1*$2*')
  out = out.replace(/\?\?([^?]+)\?\?/gu, '*$1*')
  out = out.replace(/\+\+([^+]+)\+\+/gu, '__$1__')
  out = out.replace(/\^([^^]+)\^/gu, '^$1^')
  out = out.replace(/~([^~\s]+)~/gu, '~$1~')
  return out.trim()
}

// ---- Atlassian Document Format (Cloud) → Markdown ----

interface AdfNode {
  readonly type?: unknown
  readonly text?: unknown
  readonly attrs?: { readonly level?: unknown; readonly language?: unknown; readonly url?: unknown; readonly text?: unknown } | undefined
  readonly marks?: ReadonlyArray<{ readonly type?: unknown; readonly attrs?: { readonly href?: unknown } | undefined }> | undefined
  readonly content?: unknown
}

function adfNode(node: unknown): AdfNode | undefined {
  return typeof node === 'object' && node !== null ? (node as AdfNode) : undefined
}

function adfChildren(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? node.content.map(adfNode).filter((child): child is AdfNode => child !== undefined) : []
}

/**
 * Convert an ADF document to Markdown. Recognizes the standard text block
 * structure (paragraphs, headings, lists, code, quotes, tables); unknown node
 * types render their descendant text so content is never silently dropped.
 */
export function adfToMarkdown(document: unknown): string {
  const root = adfNode(document)
  if (root === undefined || root.type !== 'doc') {
    const text = adfNodeText(adfNode(document))
    return text.trim()
  }
  const blocks = (Array.isArray(root.content) ? (root.content as unknown[]) : [])
    .map(adfNode)
    .filter((node): node is AdfNode => node !== undefined)
    .map(adfBlock)
    .filter(block => block.length > 0)
  return blocks.join('\n\n').trim()
}

function adfBlock(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph': {
      const text = adfInline(adfChildren(node))
      return text.trim().length === 0 ? '' : text
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      return `${'#'.repeat(level)} ${adfInline(adfChildren(node)).trim()}`
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return '```' + language + '\n' + adfNodeText(node) + '\n```'
    }
    case 'blockQuote':
      return adfChildren(node).map(adfBlock).filter(block => block.length > 0).map(block => block.split('\n').map(line => `> ${line}`).join('\n')).join('\n>\n')
    case 'bulletList':
      return adfList(adfChildren(node), '-', 0)
    case 'orderedList':
      return adfList(adfChildren(node), '1.', 0)
    case 'table':
      return adfTable(node)
    case 'rule':
      return '---'
    case 'mediaSingle': {
      const media = adfChildren(node).find(child => child.type === 'media')
      const alt = typeof media?.attrs?.text === 'string' ? media.attrs.text : 'attachment'
      return `_[${alt}]_`
    }
    default: {
      const text = adfInline(adfChildren(node))
      if (text.trim().length > 0) return text
      const plain = adfNodeText(node)
      return plain.trim()
    }
  }
}

function adfList(items: readonly AdfNode[], marker: string, depth: number): string {
  const out: string[] = []
  items.forEach((item, index) => {
    if (item.type !== 'listItem') {
      const text = adfInline(adfChildren(item))
      if (text.trim().length > 0) out.push(`${'  '.repeat(depth)}${marker} ${text.trim()}`)
      return
    }
    const parts = adfChildren(item)
    const first = parts[0]
    const text = first === undefined ? '' : adfBlock(first).replace(/\n/gu, ' ').trim()
    const bullet = marker === '1.' ? `${index + 1}.` : marker
    if (text.length > 0) out.push(`${'  '.repeat(depth)}${bullet} ${text}`)
    for (const nested of parts.slice(1)) {
      const block = adfBlock(nested)
      if (block.length === 0) continue
      if (nested.type === 'bulletList' || nested.type === 'orderedList') {
        out.push(adfList(adfChildren(nested), nested.type === 'orderedList' ? '1.' : '-', depth + 1))
      } else {
        out.push(block)
      }
    }
  })
  return out.join('\n')
}

function adfTable(table: AdfNode): string {
  const rows = adfChildren(table).filter(row => row.type === 'tableRow')
  const cellsOf = (row: AdfNode): string[] =>
    adfChildren(row).map(cell => adfInline(adfChildren(cell)).replace(/\|/gu, '\\|').trim())
  const [header, ...body] = rows.map(cellsOf)
  if (header === undefined || header.length === 0) return ''
  const width = header.length
  const pad = (cells: string[]): string[] => {
    const next = [...cells]
    while (next.length < width) next.push('')
    return next.slice(0, width)
  }
  const lines = [`| ${pad(header).join(' | ')} |`]
  if (body.length > 0) lines.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of body) lines.push(`| ${pad(row).join(' | ')} |`)
  return lines.join('\n')
}

/** Render inline ADF content (text runs with marks, breaks, mentions). */
function adfInline(nodes: readonly AdfNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out += '\n'
      continue
    }
    if (node.type === 'mention') {
      out += `@${typeof node.attrs?.text === 'string' ? node.attrs.text : 'user'}`
      continue
    }
    if (node.type === 'emoji') {
      out += typeof node.attrs?.text === 'string' ? node.attrs.text : ':emoji:'
      continue
    }
    if (node.type === 'text') {
      let text = typeof node.text === 'string' ? node.text : ''
      const marks = node.marks ?? []
      const has = (type: string): boolean => marks.some(mark => mark.type === type)
      const link = marks.find(mark => mark.type === 'link')?.attrs?.href
      if (typeof link === 'string' && link.length > 0) {
        text = `[${text}](${link})`
      } else {
        if (has('strong')) text = `**${text}**`
        if (has('em')) text = `*${text}*`
        if (has('code')) text = '`' + text + '`'
        if (has('strike')) text = `~~${text}~~`
        if (has('underline')) text = `__${text}__`
      }
      out += text
      continue
    }
    out += adfInline(adfChildren(node))
  }
  return out
}

/** Concatenated plain text of an ADF subtree (fallback for unknown blocks). */
function adfNodeText(node: AdfNode | undefined): string {
  if (node === undefined) return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  return adfChildren(node).map(adfNodeText).join('')
}
