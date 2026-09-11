/**
 * A tiny well-formed XML/XHTML reader for content adapters (SPEC §15.2).
 * Confluence storage bodies are well-formed XHTML, so a strict recursive
 * descent parser without external dependencies is enough; anything malformed
 * surfaces as a thrown `Error` the adapter maps to a structured failure.
 * Pure text in, node tree out — no Node or DOM dependencies.
 * @module adapters/markup
 */

/** A parsed markup node: an element, a text run, or a comment. */
export type MarkupNode = MarkupElement | MarkupText

export interface MarkupElement {
  readonly kind: 'element'
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: MarkupNode[]
}

export interface MarkupText {
  readonly kind: 'text'
  readonly value: string
}

export function isElement(node: MarkupNode | undefined): node is MarkupElement {
  return node !== undefined && node.kind === 'element'
}

export function isText(node: MarkupNode | undefined): node is MarkupText {
  return node !== undefined && node.kind === 'text'
}

/** Decode the XML built-in entities plus numeric references; unknown ones pass through. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? match
  })
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  bull: '•',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
})

/** Parse a well-formed XML/XHTML document fragment into a node tree. */
export function parseMarkup(source: string): MarkupNode[] {
  const parser = new MarkupParser(source)
  const nodes = parser.parseFragment()
  return nodes
}

class MarkupParser {
  private index = 0
  private readonly stack: MarkupElement[] = []
  private readonly roots: MarkupNode[] = []

  constructor(private readonly source: string) {}

  parseFragment(): MarkupNode[] {
    while (this.index < this.source.length) {
      const open = this.source.indexOf('<', this.index)
      if (open === -1) {
        this.emitText(this.source.slice(this.index))
        break
      }
      if (open > this.index) this.emitText(this.source.slice(this.index, open))
      if (this.source.startsWith('<!--', open)) {
        const end = this.source.indexOf('-->', open + 4)
        this.index = end === -1 ? this.source.length : end + 3
        continue
      }
      if (this.source.startsWith('<![CDATA[', open)) {
        const end = this.source.indexOf(']]>', open + 9)
        const body = this.source.slice(open + 9, end === -1 ? this.source.length : end)
        this.emitText(body)
        this.index = end === -1 ? this.source.length : end + 3
        continue
      }
      if (this.source.startsWith('<?', open)) {
        const end = this.source.indexOf('?>', open + 2)
        this.index = end === -1 ? this.source.length : end + 2
        continue
      }
      if (this.source.startsWith('<!', open)) {
        const end = this.source.indexOf('>', open + 2)
        this.index = end === -1 ? this.source.length : end + 1
        continue
      }
      this.parseTag(open)
    }
    if (this.stack.length > 0) {
      throw new Error(`unclosed element <${this.stack[this.stack.length - 1]?.name}>`)
    }
    return this.roots
  }

  private parseTag(open: number): void {
    const closing = this.source[open + 1] === '/'
    const scanFrom = closing ? open + 2 : open + 1
    const nameEnd = this.findNameEnd(scanFrom)
    if (nameEnd === -1) throw new Error('malformed tag')
    const name = this.source.slice(scanFrom, nameEnd).toLowerCase()
    const tagEnd = this.findTagEnd(nameEnd)
    if (tagEnd === -1) throw new Error('unterminated tag')
    const tagBody = this.source.slice(nameEnd, tagEnd)
    this.index = tagEnd + 1

    if (closing) {
      const current = this.stack.pop()
      if (current === undefined || current.name !== name) {
        throw new Error(`mismatched closing tag </${name}>`)
      }
      this.attach(current)
      return
    }

    const selfClosing = tagBody.trimEnd().endsWith('/')
    const element: { kind: 'element'; name: string; attrs: Record<string, string>; children: MarkupNode[] } = {
      kind: 'element',
      name,
      attrs: parseAttributes(tagBody),
      children: [],
    }
    if (selfClosing || VOID_ELEMENTS.has(name)) {
      this.attach(element)
      return
    }
    this.stack.push(element)
  }

  private findNameEnd(from: number): number {
    for (let i = from; i < this.source.length; i += 1) {
      const char = this.source.charAt(i)
      if (char === '>' || /\s/u.test(char)) return i
    }
    return -1
  }

  private findTagEnd(from: number): number {
    let quote: string | undefined
    for (let i = from; i < this.source.length; i += 1) {
      const char = this.source[i]
      if (quote !== undefined) {
        if (char === quote) quote = undefined
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === '>') return i
    }
    return -1
  }

  private emitText(raw: string): void {
    if (raw.length === 0) return
    this.attach({ kind: 'text', value: decodeEntities(raw) })
  }

  private attach(node: MarkupNode): void {
    const parent = this.stack[this.stack.length - 1]
    if (parent === undefined) this.roots.push(node)
    else parent.children.push(node)
  }
}

/** HTML void elements that never carry a closing tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr',
])

function parseAttributes(body: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1]
    if (name === undefined) continue
    const value = match[3] ?? match[4] ?? ''
    attrs[name.toLowerCase()] = decodeEntities(value)
  }
  return attrs
}

/** Concatenated descendant text of a subtree, with block-ish whitespace collapsed. */
export function textContent(nodes: readonly MarkupNode[]): string {
  let out = ''
  const walk = (list: readonly MarkupNode[]): void => {
    for (const node of list) {
      if (node.kind === 'text') out += node.value
      else walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** First descendant element with the given (lower-case) name, depth-first. */
export function findElement(nodes: readonly MarkupNode[], name: string): MarkupElement | undefined {
  for (const node of nodes) {
    if (!isElement(node)) continue
    if (node.name === name) return node
    const found = findElement(node.children, name)
    if (found !== undefined) return found
  }
  return undefined
}
