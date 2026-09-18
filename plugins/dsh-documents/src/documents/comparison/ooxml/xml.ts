/**
 * A minimal, hardened XML reader for OOXML parts (§11, §42).
 *
 * `word/document.xml` is the only place the exact paragraph, table, revision
 * and style structure of a DOCX is written down, so contract-grade comparison
 * has to read it. The plugin takes no XML dependency for the same reason it
 * takes no ZIP dependency: a document pipeline that pulls a parser into the
 * host process inherits whatever that parser does with hostile input.
 *
 * What this reader refuses, by construction:
 *
 * - **entity expansion** — only the five predefined entities and numeric
 *   character references are decoded; a document type declaration is skipped
 *   and any other entity reference is a parse error, so XXE and billion-laughs
 *   payloads cannot even be expressed;
 * - **unbounded depth or size** — depth and node counts are capped, and the
 *   caller has already capped the bytes;
 * - **prefix interpretation** — namespaces are kept as written. The caller
 *   matches on local names, which is what OOXML consumers do in practice.
 *
 * Iterative rather than recursive: a deeply nested document must fail as a
 * parse error, not as a stack overflow that takes the host down.
 */

/** A parse failure; the caller maps it onto `COMPARE_PARSE_FAILED`. */
export class XmlParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = "XmlParseError";
    this.offset = offset;
  }
}

export type XmlNode = XmlElement | XmlTextNode;

export interface XmlTextNode {
  readonly kind: "text";
  readonly value: string;
}

export interface XmlElement {
  readonly kind: "element";
  /** Local name: `p` for `<w:p>`. */
  readonly name: string;
  /** Name as written: `w:p`. */
  readonly qname: string;
  /** Attributes keyed by their name as written. */
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
}

const MAX_DEPTH = 512;
const MAX_NODES = 1_000_000;

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const NAME_START = /[A-Za-z_:]/u;
const NAME_PART = /[A-Za-z0-9_:.-]/u;

interface OpenElement {
  /** Discriminator: an element still under construction. */
  readonly open: true;
  readonly qname: string;
  readonly name: string;
  readonly attributes: Map<string, string>;
  readonly children: (OpenElement | XmlTextNode)[];
  readonly start: number;
}

/** Parse a whole part into a tree rooted at a synthetic document element. */
export function parseXml(source: string): XmlElement {
  const stack: OpenElement[] = [];
  const root: OpenElement = {
    open: true,
    qname: "#document",
    name: "#document",
    attributes: new Map(),
    children: [],
    start: 0,
  };
  stack.push(root);
  let cursor = 0;
  let nodes = 0;
  // Skip a UTF-8 BOM: some producers write one, and it is not text.
  if (source.charCodeAt(0) === 0xfeff) cursor = 1;
  while (cursor < source.length) {
    const next = source.indexOf("<", cursor);
    if (next < 0) {
      pushText(stack, source.slice(cursor), cursor);
      break;
    }
    if (next > cursor) pushText(stack, source.slice(cursor, next), cursor);
    cursor = next;
    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0) throw new XmlParseError("unterminated comment", cursor);
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", cursor)) {
      const end = source.indexOf("]]>", cursor + 9);
      if (end < 0)
        throw new XmlParseError("unterminated CDATA section", cursor);
      pushText(stack, source.slice(cursor + 9, end), cursor, true);
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<?", cursor)) {
      const end = source.indexOf("?>", cursor + 2);
      if (end < 0)
        throw new XmlParseError("unterminated processing instruction", cursor);
      cursor = end + 2;
      continue;
    }
    if (source.startsWith("<!", cursor)) {
      // A document type declaration: skipped whole, never interpreted.
      const end = source.indexOf(">", cursor + 2);
      if (end < 0) throw new XmlParseError("unterminated declaration", cursor);
      cursor = end + 1;
      continue;
    }
    if (source.startsWith("</", cursor)) {
      const end = source.indexOf(">", cursor + 2);
      if (end < 0) throw new XmlParseError("unterminated end tag", cursor);
      const name = source.slice(cursor + 2, end).trim();
      if (stack.length <= 1) {
        throw new XmlParseError(`unexpected closing tag </${name}>`, cursor);
      }
      const open = stack.pop() as OpenElement;
      if (open.qname !== name) {
        throw new XmlParseError(
          `mismatched closing tag </${name}> for <${open.qname}>`,
          cursor,
        );
      }
      cursor = end + 1;
      continue;
    }
    const parsed = parseStartTag(source, cursor);
    nodes += 1;
    if (nodes > MAX_NODES) {
      throw new XmlParseError("document has too many elements", cursor);
    }
    const element: OpenElement = {
      open: true,
      qname: parsed.qname,
      name: localName(parsed.qname),
      attributes: parsed.attributes,
      children: [],
      start: cursor,
    };
    (stack[stack.length - 1] as OpenElement).children.push(element);
    cursor = parsed.end;
    if (!parsed.selfClosing) {
      if (stack.length >= MAX_DEPTH) {
        throw new XmlParseError("document nests too deeply", cursor);
      }
      stack.push(element);
    }
  }
  if (stack.length !== 1) {
    const open = stack[stack.length - 1] as OpenElement;
    throw new XmlParseError(`unclosed element <${open.qname}>`, open.start);
  }
  return toElement(root);
}

interface ParsedStartTag {
  readonly qname: string;
  readonly attributes: Map<string, string>;
  readonly selfClosing: boolean;
  readonly end: number;
}

function parseStartTag(source: string, start: number): ParsedStartTag {
  let cursor = start + 1;
  const nameStart = cursor;
  while (cursor < source.length && NAME_PART.test(source[cursor] as string)) {
    cursor += 1;
  }
  const qname = source.slice(nameStart, cursor);
  if (qname === "" || !NAME_START.test(qname[0] as string)) {
    throw new XmlParseError("element name is not a valid XML name", start);
  }
  const attributes = new Map<string, string>();
  for (;;) {
    while (cursor < source.length && /\s/u.test(source[cursor] as string)) {
      cursor += 1;
    }
    if (cursor >= source.length) {
      throw new XmlParseError(`unterminated start tag <${qname}>`, start);
    }
    if (source[cursor] === ">") {
      return { qname, attributes, selfClosing: false, end: cursor + 1 };
    }
    if (source.startsWith("/>", cursor)) {
      return { qname, attributes, selfClosing: true, end: cursor + 2 };
    }
    const attributeStart = cursor;
    while (cursor < source.length && NAME_PART.test(source[cursor] as string)) {
      cursor += 1;
    }
    const attributeName = source.slice(attributeStart, cursor);
    if (attributeName === "") {
      throw new XmlParseError(
        `attribute name expected in <${qname}>`,
        attributeStart,
      );
    }
    while (cursor < source.length && /\s/u.test(source[cursor] as string)) {
      cursor += 1;
    }
    if (source[cursor] !== "=") {
      throw new XmlParseError(
        `attribute ${attributeName} has no value`,
        cursor,
      );
    }
    cursor += 1;
    while (cursor < source.length && /\s/u.test(source[cursor] as string)) {
      cursor += 1;
    }
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new XmlParseError(
        `attribute ${attributeName} is not quoted`,
        cursor,
      );
    }
    const valueEnd = source.indexOf(quote, cursor + 1);
    if (valueEnd < 0) {
      throw new XmlParseError(
        `attribute ${attributeName} is unterminated`,
        cursor,
      );
    }
    attributes.set(
      attributeName,
      decodeEntities(source.slice(cursor + 1, valueEnd), cursor),
    );
    cursor = valueEnd + 1;
  }
}

function pushText(
  stack: OpenElement[],
  raw: string,
  offset: number,
  rawText = false,
): void {
  if (raw === "") return;
  const value = rawText ? raw : decodeEntities(raw, offset);
  if (value === "") return;
  (stack[stack.length - 1] as OpenElement).children.push({
    kind: "text",
    value,
  });
}

function toElement(open: OpenElement): XmlElement {
  return {
    kind: "element",
    name: open.name,
    qname: open.qname,
    attributes: open.attributes,
    children: open.children.map(toNode),
  };
}

/** An element under construction is materialized; text is already final. */
function toNode(child: OpenElement | XmlTextNode): XmlNode {
  return "open" in child ? toElement(child) : child;
}

function localName(qname: string): string {
  const colon = qname.indexOf(":");
  return colon < 0 ? qname : qname.slice(colon + 1);
}

const ENTITY_PATTERN = /&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu;

function decodeEntities(text: string, offset: number): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY_PATTERN, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePointFrom(Number.parseInt(body.slice(2), 16), all, offset);
    }
    if (body.startsWith("#")) {
      return codePointFrom(Number.parseInt(body.slice(1), 10), all, offset);
    }
    const named = NAMED_ENTITIES.get(body);
    if (named === undefined) {
      // Never expand anything a document declared for itself.
      throw new XmlParseError(`unknown entity reference &${body};`, offset);
    }
    return named;
  });
}

function codePointFrom(value: number, all: string, offset: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) {
    throw new XmlParseError(`invalid character reference ${all}`, offset);
  }
  return String.fromCodePoint(value);
}

/**
 * All descendants with a matching local name, in document order. Children are
 * pushed in reverse so that popping yields pre-order, without recursion.
 */
export function descendantsNamed(
  element: XmlElement,
  name: string,
): XmlElement[] {
  const found: XmlElement[] = [];
  const stack: XmlNode[] = [...element.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as XmlNode;
    if (node.kind !== "element") continue;
    if (node.name === name) found.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index] as XmlNode);
    }
  }
  return found;
}

/** Direct children with a matching local name, in document order. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement =>
      child.kind === "element" && child.name === name,
  );
}

export function firstChildNamed(
  element: XmlElement,
  name: string,
): XmlElement | undefined {
  return element.children.find(
    (child): child is XmlElement =>
      child.kind === "element" && child.name === name,
  );
}

/**
 * An attribute by local name: `<w:val>` and `<val>` are the same attribute to
 * every consumer of these parts, and the prefix a producer chose is noise.
 */
export function attributeValue(
  element: XmlElement,
  name: string,
): string | undefined {
  for (const [key, value] of element.attributes) {
    if (localName(key) === name) return value;
  }
  return undefined;
}

/** Concatenated text of an element and its descendants, in document order. */
export function textContent(element: XmlElement): string {
  let output = "";
  const stack: XmlNode[] = [...element.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as XmlNode;
    if (node.kind === "text") {
      output += node.value;
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index] as XmlNode);
    }
  }
  return output;
}
