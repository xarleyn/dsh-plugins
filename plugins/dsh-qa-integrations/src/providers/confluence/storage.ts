/**
 * Confluence Server and Data Center answer a page body as storage format: the
 * XHTML-ish markup the editor keeps under a page, returned in
 * `body.storage.value`. Its Cloud counterpart is Atlassian Document Format,
 * which `adf.ts` renders; this module is the same trade for the self-hosted
 * product, so a caller reads a page's words instead of the wrappers around
 * them.
 *
 * The flattening is as defensive as the other renderers here, and for the same
 * reason: a body is untrusted text a reader asked for, not instructions to
 * follow. Nothing is fetched, executed or followed — a macro becomes a
 * placeholder line, a reference becomes a marker, and a macro's parameters,
 * which hold arbitrary page-authored text, are dropped except for the one that
 * names a code language. A body that is hostile (unbalanced, nested past all
 * reason, full of control characters) is still only read.
 *
 * Rendering is a scan and a small tree of kept tags, not a DOM: the body is
 * walked once by index, so a megabyte of markup costs one pass, and the depth
 * ceiling bounds both what the tree can hold and what the renderer will walk.
 */

/** A node deeper than this is not walked, and a scan does not open past it. */
const MAX_DEPTH = 64;

/** Tab and the two line endings survive; every other control character does not. */
const KEPT_CONTROL_CHARS = new Set([0x09, 0x0a, 0x0d]);

/** Elements that never hold children, so their `/>` is the whole element. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Tags the inline renderer knows. One of these at block level is a generator's
 * mistake; rendering it as text keeps the words instead of dropping them.
 */
const INLINE_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "del",
  "em",
  "i",
  "ins",
  "mark",
  "s",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "tt",
  "u",
  "ac:image",
  "ac:link",
  "ac:parameter",
  "ri:attachment",
  "ri:page",
  "ri:space",
  "ri:url",
  "ri:user",
  "ri:username",
]);

/** No entity a page holds is longer than this; a `;` past it ends none. */
const ENTITY_MAX_LENGTH = 32;

/**
 * The entities a storage body actually emits. `nbsp` becomes an ordinary
 * space: it is a layout device, and U+00A0 would reach the reader as an
 * invisible byte that looks like no space at all.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
});

/** One kept tag: its name, the attributes it carried, and its children. */
interface Element {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: (Element | string)[];
}

/** A tag field as text; an attribute a tag did not carry is the empty string. */
function fieldText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One attribute of a kept tag. Values were entity-decoded when the tag was
 * read, so only the control characters a body could smuggle through an
 * attribute are removed here.
 */
function attr(element: Element, name: string): string {
  return flatten(fieldText(element.attrs[name]));
}

/** Only the tags among a node's children; text is read where text means text. */
function childElements(element: Element): Element[] {
  return element.children.filter(
    (child): child is Element => typeof child !== "string",
  );
}

/**
 * Control characters carry no meaning in a page body and would only be noise in
 * an answer, so they are dropped; asking a regular expression to do it reads as
 * a control-character range and lint refuses it, which is why this is a plain
 * walk — the same policy and the same implementation as the ADF renderer.
 */
function flatten(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    if (control && !KEPT_CONTROL_CHARS.has(code)) continue;
    result += char;
  }
  return result;
}

/** The indentation a pretty-printed body carries is not the reader's text. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}

/** A tag that rendered nothing can leave two spaces; a page reads with one. */
function collapseSpaces(value: string): string {
  return value.replace(/ {2,}/gu, " ");
}

/** Line endings around a code body are the body's edges, not its text. */
function trimNewlines(value: string): string {
  return value.replace(/^[\r\n]+|[\r\n]+$/gu, "");
}

/** The character one entity names, or `undefined` when it names none we know. */
function decodedEntity(name: string): string | undefined {
  const named = NAMED_ENTITIES[name];
  if (named !== undefined) return named;
  if (!name.startsWith("#")) return undefined;
  const hexadecimal = name.startsWith("#x") || name.startsWith("#X");
  const digits = name.slice(hexadecimal ? 2 : 1);
  const pattern = hexadecimal ? /^[0-9a-f]+$/iu : /^[0-9]+$/u;
  if (!pattern.test(digits)) return undefined;
  const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
  // A surrogate half or a code point outside Unicode is not a character.
  if (code < 1 || code > 0x10ffff) return undefined;
  if (code >= 0xd800 && code <= 0xdfff) return undefined;
  return String.fromCodePoint(code);
}

/**
 * Undo the entities of one text run. The walk resumes after the entity it just
 * replaced, so `&amp;lt;` reads as the page wrote it — `&lt;` — and is never
 * decoded twice.
 */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  let result = "";
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf("&", index);
    if (start === -1) {
      result += value.slice(index);
      break;
    }
    const end = value.indexOf(";", start + 1);
    if (end === -1 || end - start > ENTITY_MAX_LENGTH) {
      result += value.slice(index, start + 1);
      index = start + 1;
      continue;
    }
    const decoded = decodedEntity(value.slice(start + 1, end));
    if (decoded === undefined) {
      result += value.slice(index, start + 1);
      index = start + 1;
      continue;
    }
    result += value.slice(index, start) + decoded;
    index = end + 1;
  }
  return result;
}

/** Letters, digits and the `:` `-` `_` `.` a tag or attribute is named with. */
function isNameChar(code: number): boolean {
  const digit = code >= 0x30 && code <= 0x39;
  const letter =
    (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  return (
    digit ||
    letter ||
    code === 0x3a || // :
    code === 0x2d || // -
    code === 0x5f || // _
    code === 0x2e // .
  );
}

/** The index just past the tag name starting at `from` (which it is if none). */
function nameEnd(source: string, from: number): number {
  let index = from;
  while (index < source.length && isNameChar(source.charCodeAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * The index of the `>` that ends a tag, skipping the ones an attribute value may
 * carry, or `-1` when the tag never ends.
 */
function endOfTag(source: string, from: number): number {
  let quote = "";
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) break;
    if (quote !== "") {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

/** `name="value"` pairs of one tag; anything else in there names no attribute. */
const ATTRIBUTE =
  /([A-Za-z][\w:.-]*)\s*=\s*"([^"]*)"|([A-Za-z][\w:.-]*)\s*=\s*'([^']*)'/gu;

/** The attributes of one tag, entity-decoded, unquoted ones left out. */
function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1] ?? match[3] ?? "";
    if (name === "") continue;
    attrs[name] = decodeEntities(match[2] ?? match[4] ?? "");
  }
  return attrs;
}

/** Add a text run to an element, joining it to the run already there. */
function appendText(element: Element, value: string): void {
  if (value === "") return;
  const last = element.children[element.children.length - 1];
  if (typeof last === "string") {
    element.children[element.children.length - 1] = last + value;
    return;
  }
  element.children.push(value);
}

/**
 * A list item or a paragraph ends the one it opens inside of: storage format is
 * XHTML and normally balanced, but a hand-built or generated body is not.
 */
function implicitClose(stack: Element[], name: string): void {
  if (name !== "li" && name !== "p") return;
  let open = stack[stack.length - 1];
  while (
    open !== undefined &&
    (open.name === name || (name === "li" && open.name === "p"))
  ) {
    stack.pop();
    open = stack[stack.length - 1];
  }
}

/** Close the open tag this name belongs to, and everything it contained. */
function closeTag(stack: Element[], name: string): void {
  if (name === "") return;
  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index]?.name === name) {
      stack.length = index;
      return;
    }
  }
}

/** Open one tag: attach it, and keep it open unless it can hold nothing. */
function openTag(
  source: string,
  from: number,
  end: number,
  stack: Element[],
  parent: Element,
): void {
  const name = source.slice(from, nameEnd(source, from)).toLowerCase();
  if (name === "") return;
  const selfClosing = source[end - 1] === "/";
  const element: Element = {
    name,
    attrs: parseAttrs(source.slice(from, selfClosing ? end - 1 : end)),
    children: [],
  };
  implicitClose(stack, name);
  const container = stack[stack.length - 1] ?? parent;
  container.children.push(element);
  if (selfClosing || VOID_TAGS.has(name)) return;
  // Past the rendering ceiling a tag is not opened any more, which bounds the
  // tree a hostile body can build. One level past the ceiling is still kept, so
  // that the walk always stops on its own guard rather than on a cut tree.
  if (stack.length - 1 > MAX_DEPTH) return;
  stack.push(element);
}

/**
 * Read the markup starting at one `<`, which is either a comment, a CDATA
 * section, a declaration, a closing tag or an opening tag. Returns the index to
 * continue from; the scan always moves forward, so no input can trap it.
 */
function readMarkup(
  source: string,
  start: number,
  stack: Element[],
  current: Element,
): number {
  if (source.startsWith("<!--", start)) {
    const end = source.indexOf("-->", start + "<!--".length);
    return end === -1 ? source.length : end + "-->".length;
  }
  if (source.startsWith("<![CDATA[", start)) {
    const body = start + "<![CDATA[".length;
    const end = source.indexOf("]]>", body);
    // CDATA is not escaped, so its text is kept exactly as the page sent it.
    appendText(
      current,
      end === -1 ? source.slice(body) : source.slice(body, end),
    );
    return end === -1 ? source.length : end + "]]>".length;
  }
  if (source.startsWith("</", start)) {
    const end = endOfTag(source, start + 2);
    if (end === -1) return source.length;
    const name = source.slice(start + 2, nameEnd(source, start + 2));
    closeTag(stack, name.trim().toLowerCase());
    return end + 1;
  }
  if (source.startsWith("<!", start) || source.startsWith("<?", start)) {
    const end = source.indexOf(">", start + 2);
    return end === -1 ? source.length : end + 1;
  }
  const end = endOfTag(source, start + 1);
  if (end === -1) {
    // A `<` that never closes is a character a page wrote, not markup.
    appendText(current, decodeEntities(source.slice(start)));
    return source.length;
  }
  openTag(source, start + 1, end, stack, current);
  return end + 1;
}

/**
 * Storage markup as a tree of kept elements and text, in one forward pass.
 * Open tags live on a stack rather than on the call stack, so a body cannot
 * exhaust the stack before rendering even starts; past the depth ceiling a tag
 * is no longer opened, which bounds the tree a hostile body can build.
 */
function parseMarkup(source: string): Element {
  const root: Element = { name: "", attrs: {}, children: [] };
  const stack: Element[] = [root];
  let index = 0;
  while (index < source.length) {
    const current = stack[stack.length - 1] ?? root;
    const start = source.indexOf("<", index);
    if (start === -1) {
      appendText(current, decodeEntities(source.slice(index)));
      break;
    }
    if (start > index) {
      appendText(current, decodeEntities(source.slice(index, start)));
    }
    index = readMarkup(source, start, stack, current);
  }
  return root;
}

/** One text run as the reader sees it: entities undone, indentation collapsed. */
function text(value: string): string {
  return flatten(collapseWhitespace(value));
}

/** Everything a tag holds, its own tags dropped and its text left as it read. */
function rawText(element: Element): string {
  let result = "";
  for (const child of element.children) {
    result += typeof child === "string" ? child : rawText(child);
  }
  return result;
}

/** A fenced code block, language-tagged the way the ADF renderer fences one. */
function fence(language: string, code: string): string {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/** The code or preformatted text a body element holds, its edges tidied. */
function codeOf(element: Element): string {
  return flatten(trimNewlines(rawText(element)));
}

/** The provider's stand-in for something a page points at and never shows. */
function marker(kind: string, label: string): string {
  return label === "" ? `[${kind}]` : `[${kind}: ${label}]`;
}

/** One named parameter of a macro. Only a code language is ever read out. */
function parameter(element: Element, name: string): string {
  const found = childElements(element).find(
    (child) => child.name === "ac:parameter" && attr(child, "ac:name") === name,
  );
  return found === undefined ? "" : text(rawText(found)).trim();
}

/** The code body of a code macro: its plain-text body, or the `pre` it wraps. */
function macroCode(element: Element): string {
  const children = childElements(element);
  const plain = children.find((child) => child.name === "ac:plain-text-body");
  const source =
    plain ??
    children.find((child) => child.name === "pre" || child.name === "code");
  return source === undefined ? "" : codeOf(source);
}

/** A macro's only reader-visible content: its body, never its parameters. */
function macroBody(element: Element, depth: number): string {
  if (attr(element, "ac:name") === "code") {
    const code = macroCode(element);
    return code === "" ? "" : fence(parameter(element, "language"), code);
  }
  const rich = childElements(element).find(
    (child) => child.name === "ac:rich-text-body",
  );
  if (rich !== undefined) return blocks(rich.children, depth + 1).join("\n\n");
  const plain = childElements(element).find(
    (child) => child.name === "ac:plain-text-body",
  );
  return plain === undefined ? "" : codeOf(plain);
}

/** A macro is never executed: it is a placeholder and, maybe, its body. */
function macro(element: Element, depth: number): string {
  const name = attr(element, "ac:name");
  const head = name === "" ? "[macro]" : `[macro: ${name}]`;
  const body = macroBody(element, depth);
  return body === "" ? head : `${head}\n${body}`;
}

/** An image is a marker naming what a page pointed at, never the bytes. */
function image(element: Element): string {
  const alt = attr(element, "ac:alt");
  if (alt !== "") return marker("image", alt);
  const attachment = childElements(element).find(
    (child) => child.name === "ri:attachment",
  );
  const filename =
    attachment === undefined ? "" : attr(attachment, "ri:filename");
  return marker("image", filename);
}

/** The words a link shows: its body elements, or the reference it points at. */
function linkText(element: Element, depth: number): string {
  const shown = element.children
    .filter(
      (child): child is Element =>
        typeof child !== "string" &&
        (child.name === "ac:link-body" ||
          child.name === "ac:plain-text-link-body"),
    )
    .map((child) =>
      child.name === "ac:plain-text-link-body"
        ? text(rawText(child))
        : inlineChildren(child, depth + 1),
    )
    .join("");
  return shown !== "" ? shown : inlineChildren(element, depth);
}

/** A link's own words, with an address kept beside them but never travelled. */
function link(element: Element, depth: number): string {
  const url = childElements(element).find((child) => child.name === "ri:url");
  const href = url === undefined ? "" : attr(url, "ri:value");
  const body = collapseSpaces(linkText(element, depth)).trim();
  if (body === "") return href === "" ? "[link]" : href;
  return href === "" ? body : `[${body}](${href})`;
}

/** One inline child: a text run, or a tag the inline renderer knows. */
function inlineChild(child: Element | string, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  return typeof child === "string" ? text(child) : inline(child, depth);
}

/** Inline children joined without separators, each carrying its own marks. */
function inlineChildren(element: Element, depth: number): string {
  return element.children
    .map((child) => inlineChild(child, depth + 1))
    .join("");
}

/** An empty wrapper would only leave stray marks in the answer. */
function wrap(inner: string, open: string, close: string): string {
  return inner === "" ? "" : `${open}${inner}${close}`;
}

/** One inline tag as text; an unknown one keeps its words and loses its tag. */
function inline(element: Element, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  switch (element.name) {
    case "strong":
    case "b":
      return wrap(inlineChildren(element, depth), "**", "**");
    case "em":
    case "i":
      return wrap(inlineChildren(element, depth), "_", "_");
    case "s":
    case "del":
    case "strike":
      return wrap(inlineChildren(element, depth), "~~", "~~");
    case "code":
      return wrap(text(rawText(element)).trim(), "`", "`");
    case "br":
      return "\n";
    case "a": {
      const href = attr(element, "href");
      const inner = inlineChildren(element, depth);
      if (inner === "") return href;
      return href === "" ? inner : `[${inner}](${href})`;
    }
    // A macro's parameters are its configuration, not the page's words.
    case "ac:parameter":
      return "";
    case "ac:image":
      return image(element);
    case "ac:link":
      return link(element, depth);
    case "ac:structured-macro":
      return macro(element, depth);
    case "ri:attachment":
      return marker("attachment", attr(element, "ri:filename"));
    case "ri:page": {
      const title =
        attr(element, "ri:content-title") || attr(element, "ri:page-title");
      return marker("page", title);
    }
    case "ri:space":
      return marker("space", attr(element, "ri:space-key"));
    case "ri:user": {
      // A mention is a name: the provider does not resolve an account for it.
      const name =
        attr(element, "ri:username") || text(rawText(element)).trim();
      return name === "" ? "@" : `@${name}`;
    }
    default:
      return inlineChildren(element, depth);
  }
}

/** Inline content of a block, as one run of text with its edges tightened. */
function inlineText(element: Element, depth: number): string {
  return collapseSpaces(inlineChildren(element, depth)).trim();
}

/** An item's first line, followed by the blocks that come after it. */
function itemBlocks(item: Element, depth: number): string[] {
  const head: string[] = [];
  let index = 0;
  while (index < item.children.length) {
    const child = item.children[index];
    if (child === undefined) break;
    const part =
      typeof child === "string"
        ? text(child)
        : INLINE_TAGS.has(child.name)
          ? inline(child, depth + 1)
          : undefined;
    if (part === undefined) break;
    head.push(part);
    index += 1;
  }
  const rest = item.children
    .slice(index)
    .map((child) =>
      typeof child === "string" ? text(child).trim() : block(child, depth),
    );
  return [collapseSpaces(head.join("")).trim(), ...rest];
}

/** List items, with the text aligned under the marker of each item. */
function listItems(element: Element, depth: number, ordered: boolean): string {
  const indent = "  ".repeat(depth);
  return childElements(element)
    .filter((item) => item.name === "li")
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const pad = " ".repeat(marker.length);
      const lines = itemBlocks(item, depth).filter((line) => line !== "");
      if (lines.length === 0) return "";
      return lines
        .join("\n")
        .split("\n")
        .map((line, position) =>
          position === 0
            ? `${indent}${marker}${line}`
            : `${indent}${pad}${line}`,
        )
        .join("\n");
    })
    .filter((item) => item !== "")
    .join("\n");
}

/** One cell of a table row, with the text a cell may not carry removed. */
function cellText(cell: Element, depth: number): string {
  const inner = cell.children
    .map((child) =>
      typeof child === "string" ? text(child).trim() : block(child, depth + 1),
    )
    .filter((part) => part !== "")
    .join(" ");
  // A pipe would end the cell early, and a line break has no meaning inside one.
  return collapseSpaces(inner).replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** The rows of a table, whether or not the body wrapped them in a section. */
function rowsOf(element: Element): Element[] {
  const rows: Element[] = [];
  for (const child of childElements(element)) {
    if (child.name === "tr") rows.push(child);
    else if (
      child.name === "thead" ||
      child.name === "tbody" ||
      child.name === "tfoot"
    ) {
      rows.push(...childElements(child).filter((row) => row.name === "tr"));
    }
  }
  return rows;
}

/** Rows as `| a | b |`, with a separator under a row that is all headers. */
function table(element: Element, depth: number): string {
  const lines: string[] = [];
  rowsOf(element).forEach((row, index) => {
    const cells = childElements(row).filter(
      (cell) => cell.name === "td" || cell.name === "th",
    );
    if (cells.length === 0) return;
    const rendered = cells.map((cell) => cellText(cell, depth + 1));
    lines.push(`| ${rendered.join(" | ")} |`);
    const header = index === 0 && cells.every((cell) => cell.name === "th");
    if (header) lines.push(`| ${rendered.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n");
}

/** One block-level tag as text; an empty string when it carries nothing. */
function block(element: Element, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  switch (element.name) {
    case "p":
      return inlineText(element, depth);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(element.name.slice(1));
      return `${"#".repeat(level)} ${inlineText(element, depth)}`;
    }
    case "ul":
      return listItems(element, depth, false);
    case "ol":
      return listItems(element, depth, true);
    case "li":
      // A stray item outside a list still reads as an item.
      return `${"  ".repeat(depth)}- ${inlineText(element, depth)}`;
    case "table":
      return table(element, depth);
    case "blockquote":
      return quote(element, depth);
    case "pre":
      return fence("", codeOf(element));
    case "hr":
      return "---";
    case "br":
      return "";
    case "ac:structured-macro":
      return macro(element, depth);
    case "ac:parameter":
      return "";
    case "ac:plain-text-body":
      return codeOf(element);
    default:
      if (INLINE_TAGS.has(element.name)) return inline(element, depth);
      // An unknown block: keep the words, drop the wrapper we cannot vouch for.
      return blocks(element.children, depth + 1).join("\n\n");
  }
}

/** A quote as a prefixed block, its blank lines prefixed too. */
function quote(element: Element, depth: number): string {
  return blocks(element.children, depth + 1)
    .join("\n\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function blocks(
  children: readonly (Element | string)[],
  depth: number,
): string[] {
  if (depth > MAX_DEPTH) return [];
  return children
    .map((child) =>
      typeof child === "string" ? text(child).trim() : block(child, depth),
    )
    .filter((part) => part !== "");
}

/** Whether a value looks like a storage body rather than a plain string. */
export function isStorage(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // A Cloud body arrives as JSON, handled by `adf.ts`, and never starts with a
  // tag; the first character that is not a space decides.
  return /^\s*<[A-Za-z]/u.test(value);
}

/**
 * Render one storage-format body to markdown-like text, or "" when there is
 * nothing to render.
 */
export function storageToText(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  return blocks(parseMarkup(value).children, 0)
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
