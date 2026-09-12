/**
 * Confluence content adapter (SPEC §15.2/§16): recognize page URLs, fetch the
 * page through the Confluence REST API with the SAME authenticated transport,
 * and normalize the storage-format XHTML body into compact Markdown text —
 * page metadata plus the readable content, without theme chrome or macros.
 * Page-id URLs (`/pages/<id>`) fetch directly; `/display/<SPACE>/<Title>`
 * URLs resolve the page by space key and title first.
 * @module adapters/confluence
 */

import type { ResolvedAdapter } from '../types.js'
import * as errors from '../errors.js'
import { isElement, isText, parseMarkup, textContent, type MarkupElement, type MarkupNode } from './markup.js'

export type FetchJson = (url: URL) => Promise<{ statusCode: number; data: unknown }>

/** A recognized Confluence page reference. */
export interface PageRef {
  /** Numeric content id, for direct `/pages/<id>` URLs. */
  readonly id?: string
  /** Display-URL lookup: space key + title. */
  readonly spaceKey?: string
  readonly title?: string
}

/**
 * Extract a page reference from a URL path. Recognizes:
 * - `/**\/pages/<id>/**` (Server and Cloud; Cloud paths carry a `/wiki` prefix),
 * - `/**\/display/<SPACE>/<Title+With+Plus>` (Server display URLs).
 * Returns `undefined` for URLs the adapter cannot map.
 */
export function extractPageRef(pathname: string): PageRef | undefined {
  const segments = pathname.split('/').filter(segment => segment.length > 0)
  const pagesIndex = segments.lastIndexOf('pages')
  if (pagesIndex >= 0) {
    const id = segments[pagesIndex + 1]
    if (id !== undefined && /^\d+$/u.test(id)) return { id }
  }
  const displayIndex = segments.lastIndexOf('display')
  if (displayIndex >= 0) {
    const spaceKey = segments[displayIndex + 1]
    const title = segments.slice(displayIndex + 2).join('/')
    if (spaceKey !== undefined && title.length > 0) {
      return { spaceKey: spaceKey.toUpperCase(), title: decodeURIComponent(title).replace(/\+/gu, ' ') }
    }
  }
  return undefined
}

/**
 * REST base path prefix: Cloud paths live under `/wiki` and so does its REST
 * API; Server instances serve `/rest/api` at the origin root.
 */
export function restPrefix(pathname: string): string {
  return /^\/wiki(?:\/|$)/u.test(pathname) ? '/wiki/rest/api' : '/rest/api'
}

/** REST URL of one content item with the expansions the renderer needs. */
export function contentApiUrl(origin: string, prefix: string, id: string): URL {
  const url = new URL(`${prefix}/content/${id}`, origin)
  url.searchParams.set('expand', 'body.storage,space,version')
  return url
}

/** REST URL of the space-key + title lookup used by `/display/` URLs. */
export function contentLookupUrl(origin: string, prefix: string, spaceKey: string, title: string): URL {
  const url = new URL(`${prefix}/content`, origin)
  url.searchParams.set('spaceKey', spaceKey)
  url.searchParams.set('title', title)
  url.searchParams.set('expand', 'body.storage,space,version')
  return url
}

interface ContentResult {
  readonly id?: unknown
  readonly title?: unknown
  readonly space?: { readonly name?: unknown; readonly key?: unknown }
  readonly version?: { readonly when?: unknown; readonly number?: unknown }
  readonly body?: { readonly storage?: { readonly value?: unknown } }
}

/** Fetch a Confluence page and normalize it into Markdown text. */
export async function fetchPageMarkdown(
  requestUrl: URL,
  adapter: ResolvedAdapter,
  fetchJson: FetchJson,
): Promise<{ statusCode: number; markdown: string }> {
  const ref = extractPageRef(requestUrl.pathname)
  if (ref === undefined) throw errors.adapterFailed(`URL path "${requestUrl.pathname}" is not a recognizable Confluence page URL`)
  const prefix = restPrefix(requestUrl.pathname)
  let response: { statusCode: number; data: unknown }
  if (ref.id !== undefined) {
    response = await fetchJson(contentApiUrl(requestUrl.origin, prefix, ref.id))
  } else {
    response = await fetchJson(contentLookupUrl(requestUrl.origin, prefix, ref.spaceKey ?? '', ref.title ?? ''))
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Non-2xx stays a RESULT (the seam contract), like the Jira adapter.
    const target = ref.id !== undefined ? `page ${ref.id}` : `"${ref.title}" in space ${ref.spaceKey}`
    return {
      statusCode: response.statusCode,
      markdown: `[Confluence] The Confluence REST API returned HTTP ${response.statusCode} for ${target} at ${requestUrl.origin}${prefix}.`,
    }
  }
  const page = asContent(response.data)
  const markdown = renderPage(page)
  return { statusCode: response.statusCode, markdown }
}

function asContent(data: unknown): ContentResult {
  // The title lookup returns a results envelope; direct fetches return the page.
  const record = data as { results?: unknown } & ContentResult
  if (Array.isArray(record.results)) {
    const first = record.results[0]
    if (typeof first !== 'object' || first === null) {
      throw errors.adapterFailed('Confluence REST lookup returned no page for the requested title')
    }
    return first as ContentResult
  }
  return record
}

function renderPage(page: ContentResult): string {
  const lines: string[] = []
  const title = typeof page.title === 'string' && page.title.length > 0 ? page.title : 'Untitled page'
  const space = typeof page.space?.name === 'string' ? page.space.name : typeof page.space?.key === 'string' ? page.space.key : undefined
  const updated = typeof page.version?.when === 'string' ? page.version.when.slice(0, 10) : undefined
  lines.push(`# ${title}`)
  lines.push('')
  const facts: string[] = []
  if (space !== undefined) facts.push(`Space: ${space}`)
  if (updated !== undefined) facts.push(`Updated: ${updated}`)
  if (facts.length > 0) {
    for (const fact of facts) lines.push(`- ${fact}`)
    lines.push('')
  }
  const storage = page.body?.storage?.value
  if (typeof storage === 'string' && storage.trim().length > 0) {
    lines.push(storageToMarkdown(storage))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

// ---- Confluence storage-format XHTML → Markdown ----

/** Convert a Confluence storage body (XHTML + `ac:` macros) into Markdown. */
export function storageToMarkdown(storage: string): string {
  const nodes = parseMarkup(storage)
  const blocks = renderBlocks(nodes)
  return blocks.join('\n\n').replace(/\n{3,}/gu, '\n\n').trim()
}

/** Elements whose rendered content stays on the current block. */
const INLINE_ELEMENTS: ReadonlySet<string> = new Set([
  'span', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'sub', 'sup', 'tt',
  'br', 'ac:link', 'ac:emoticon', 'ac:plain-text-link-body', 'ac:link-body', 'ac:image', 'ri:attachment', 'ri:page', 'ri:user', 'ac:placeholder',
])

function renderBlocks(nodes: readonly MarkupNode[]): string[] {
  const out: string[] = []
  let inlineBuffer: string[] = []
  const flush = (): void => {
    const text = inlineBuffer.join('').trim()
    inlineBuffer = []
    if (text.length > 0) out.push(text)
  }
  for (const node of nodes) {
    if (isText(node)) {
      inlineBuffer.push(collapseWhitespace(node.value))
      continue
    }
    if (INLINE_ELEMENTS.has(node.name)) {
      inlineBuffer.push(renderInlineElement(node))
      continue
    }
    flush()
    out.push(...renderBlockElement(node))
  }
  flush()
  return out.filter(block => block.length > 0)
}

function renderBlockElement(node: MarkupElement): string[] {
  switch (node.name) {
    case 'p': {
      const text = renderInline(node.children).replace(/\s+/gu, ' ').trim()
      return text.length === 0 ? [] : [text]
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = renderInline(node.children).trim()
      return text.length === 0 ? [] : [`${'#'.repeat(Number(node.name.slice(1)))} ${text}`]
    }
    case 'ul':
    case 'ol':
      return renderList(node, node.name === 'ol' ? 1 : 0, 0)
    case 'blockquote': {
      const inner = renderBlocks(node.children).join('\n\n')
      return inner.length === 0 ? [] : [inner.split('\n').map(line => `> ${line}`).join('\n')]
    }
    case 'pre':
      return ['```\n' + textContent(node.children).replace(/\n$/u, '') + '\n```']
    case 'table':
      return renderTable(node)
    case 'hr':
      return ['---']
    case 'ac:structured-macro':
      return [renderMacro(node)].filter(block => block.length > 0)
    case 'ac:layout':
    case 'ac:layout-section':
    case 'ac:layout-cell':
    case 'div':
    case 'section':
    case 'article':
    case 'tbody':
    case 'thead':
    case 'tfoot':
      return renderBlocks(node.children)
    default:
      // Unknown block elements: keep their text so content is never dropped.
      return renderBlocks(node.children)
  }
}

function renderInlineElement(node: MarkupElement): string {
  switch (node.name) {
    case 'br':
      return '  \n'
    case 'a': {
      const href = node.attrs.href ?? ''
      const text = renderInline(node.children).trim()
      if (href.length === 0) return text
      return `[${text.length > 0 ? text : href}](${href})`
    }
    case 'strong':
    case 'b': {
      const text = renderInline(node.children).trim()
      return text.length === 0 ? '' : `**${text}**`
    }
    case 'em':
    case 'i': {
      const text = renderInline(node.children).trim()
      return text.length === 0 ? '' : `*${text}*`
    }
    case 's':
    case 'strike': {
      const text = renderInline(node.children).trim()
      return text.length === 0 ? '' : `~~${text}~~`
    }
    case 'code':
    case 'tt': {
      const text = textContent(node.children)
      return text.length === 0 ? '' : '`' + text + '`'
    }
    case 'ac:emoticon':
      return node.attrs['ac:name'] ?? ''
    case 'ac:link':
      return renderAcLink(node)
    case 'ac:placeholder':
      return ''
    case 'ac:image':
    case 'ri:attachment': {
      const name = node.attrs['ri:filename'] ?? findDescendantAttr(node, 'ri:attachment', 'ri:filename') ?? 'attachment'
      return `_[${name}]_`
    }
    default:
      return renderInline(node.children)
  }
}

function renderAcLink(node: MarkupElement): string {
  const body = node.children.find(child => isElement(child) && (child.name === 'ac:link-body' || child.name === 'ac:plain-text-link-body'))
  let label: string | undefined
  if (isElement(body)) {
    label = body.name === 'ac:plain-text-link-body'
      ? textContent(body.children).trim()
      : renderInline(body.children).trim()
  }
  const pageRef = findDescendantAttr(node, 'ri:page', 'ri:content-title')
  const anchor = node.attrs['ac:anchor']
  if (label !== undefined && label.length > 0) return label
  if (typeof pageRef === 'string' && pageRef.length > 0) return pageRef
  if (typeof anchor === 'string' && anchor.length > 0) return anchor
  return ''
}

function findDescendantAttr(node: MarkupElement, name: string, attr: string): string | undefined {
  for (const child of node.children) {
    if (!isElement(child)) continue
    if (child.name === name) {
      const value = child.attrs[attr]
      if (typeof value === 'string') return value
    }
    const found = findDescendantAttr(child, name, attr)
    if (found !== undefined) return found
  }
  return undefined
}

/** Render one `ac:structured-macro` to a Markdown block. */
function renderMacro(node: MarkupElement): string {
  const name = node.attrs['ac:name'] ?? 'macro'
  const parameter = (parameterName: string): string | undefined => {
    for (const child of node.children) {
      if (isElement(child) && child.name === 'ac:parameter' && child.attrs['ac:name'] === parameterName) {
        return textContent(child.children).trim()
      }
    }
    return undefined
  }
  // Code macros are the ones the model actually needs verbatim.
  if (name === 'code') {
    const language = parameter('language') ?? parameter('syntaxhighlighter-parameter') ?? ''
    const bodyElement = node.children.find(child => isElement(child) && child.name === 'ac:plain-text-body')
    const body = bodyElement === undefined || !isElement(bodyElement) ? '' : textContent(bodyElement.children).replace(/\n$/u, '')
    if (body.trim().length === 0) return ''
    return '```' + language + '\n' + body + '\n```'
  }
  if (name === 'noformat') {
    const bodyElement = node.children.find(child => isElement(child) && child.name === 'ac:plain-text-body')
    const body = bodyElement === undefined || !isElement(bodyElement) ? '' : textContent(bodyElement.children).replace(/\n$/u, '')
    if (body.trim().length === 0) return ''
    return '```\n' + body + '\n```'
  }
  if (name === 'panel' || name === 'info' || name === 'note' || name === 'warning' || name === 'tip') {
    const inner = renderBlocks(node.children).join('\n\n')
    return inner.length === 0 ? '' : inner.split('\n').map(line => `> ${line}`).join('\n')
  }
  if (name === 'expand') {
    const title = parameter('title')
    const inner = renderBlocks(node.children).join('\n\n')
    const header = title !== undefined && title.length > 0 ? `**${title}**` : ''
    return [header, inner].filter(part => part.length > 0).join('\n\n')
  }
  if (name === 'toc' || name === 'toc-zone' || name === 'recently-updated' || name === 'children' || name === 'page-tree') {
    return ''
  }
  // Every other macro: keep a visible placeholder so the model knows
  // structured content existed here instead of silently dropping it.
  const inline = renderInline(node.children).trim()
  return `_[macro: ${name}${inline.length > 0 ? ` — ${inline}` : ''}]_`
}

function renderList(node: MarkupElement, ordered: number | 0, depth: number): string[] {
  const out: string[] = []
  let index = 0
  for (const child of node.children) {
    if (!isElement(child) || child.name !== 'li') continue
    index += 1
    const marker = ordered === 0 ? '-' : `${ordered + index - 1}.`
    const inline: string[] = []
    const nested: string[] = []
    for (const part of child.children) {
      if (!isElement(part)) {
        const text = collapseWhitespace(part.value).trim()
        if (text.length > 0) inline.push(text)
        continue
      }
      if (INLINE_ELEMENTS.has(part.name) || part.name === 'p') inline.push(renderInlineElement(part))
      else if (part.name === 'ul' || part.name === 'ol') nested.push(...renderList(part, part.name === 'ol' ? 1 : 0, depth + 1))
      else nested.push(...renderBlockElement(part))
    }
    const text = inline.join('').trim()
    out.push(`${'  '.repeat(depth)}${marker} ${text}`)
    out.push(...nested)
  }
  return out
}

function renderTable(node: MarkupElement): string[] {
  const rows: string[][] = []
  for (const child of node.children) {
    if (!isElement(child) || child.name !== 'tr') {
      if (isElement(child) && (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot')) {
        for (const row of child.children) {
          if (isElement(row) && row.name === 'tr') rows.push(rowCells(row))
        }
      }
      continue
    }
    rows.push(rowCells(child))
  }
  if (rows.length === 0) return []
  const width = Math.max(...rows.map(row => row.length), 1)
  const emit = (cells: string[]): string => `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? '').trim()).join(' | ')} |`
  const out = [emit(rows[0] ?? []), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`]
  for (const row of rows.slice(1)) out.push(emit(row))
  return out
}

function rowCells(row: MarkupElement): string[] {
  const cells: MarkupElement[] = []
  for (const child of row.children) {
    if (isElement(child) && (child.name === 'td' || child.name === 'th')) cells.push(child)
  }
  return cells.map(cell => {
    const blocks = renderBlocks(cell.children)
    return blocks.join(' ').replace(/\|/gu, '\\|').trim()
  })
}

/** Render any inline run of nodes to text (paragraph bodies, headings). */
function renderInline(nodes: readonly MarkupNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (isText(node)) {
      out += node.value
      continue
    }
    if (INLINE_ELEMENTS.has(node.name)) {
      out += renderInlineElement(node)
      continue
    }
    out += renderInline(node.children)
  }
  return out
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t\r\n]+/gu, ' ')
}
