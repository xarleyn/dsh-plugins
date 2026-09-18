/**
 * GFM inline grammar.
 *
 * Produces a node tree, never a string of HTML, so the renderer decides what
 * exists in the DOM. A construct the grammar does not know — an HTML tag
 * included — stays a `text` node and renders as the literal characters it is
 * made of.
 */

/** One inline node. `children` only ever hold inline nodes. */
export type InlineNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "em"; readonly children: readonly InlineNode[] }
  | { readonly kind: "strike"; readonly children: readonly InlineNode[] }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly InlineNode[];
    }
  | { readonly kind: "image"; readonly src: string; readonly alt: string };

/** Nesting ceiling: enough for real prose, low enough to stay linear. */
const MAX_DEPTH = 8;

const CODE_SPAN = /^(?<ticks>`+)(?<body>[\s\S]*?)\k<ticks>/u;
const IMAGE = /^!\[(?<alt>[^\]]*)\]\((?<src>[^()\s]+)[^()]*\)/u;
const LINK = /^\[(?<text>[^\]]*)\]\((?<href>[^()\s]+)(?:\s+"[^"]*")?\)/u;
const AUTOLINK = /^<(?<url>[a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]+)>/u;
const STRONG = /^(?:\*\*|__)(?<body>[\s\S]+?)(?:\*\*|__)/u;
const STRIKE = /^~~(?<body>[\s\S]+?)~~/u;
const EMPHASIS = /^[*_](?<body>[\s\S]+?)[*_]/u;

/** Characters that may be backslash-escaped into literal text. */
const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";

/**
 * Parse inline Markdown.
 *
 * @param source - raw inline text.
 */
export function parseInline(source: string): readonly InlineNode[] {
  return parseInto(source, 0);
}

function parseInto(source: string, depth: number): readonly InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    nodes.push({ kind: "text", text: buffer });
    buffer = "";
  };

  const push = (node: InlineNode): void => {
    flush();
    nodes.push(node);
  };

  while (index < source.length) {
    const char = source[index] ?? "";
    const rest = source.slice(index);

    if (char === "\\" && ESCAPABLE.includes(source[index + 1] ?? "")) {
      buffer += source[index + 1] ?? "";
      index += 2;
      continue;
    }

    if (char === "`") {
      const match = CODE_SPAN.exec(rest);
      if (match !== null) {
        push({ kind: "code", text: (match.groups?.body ?? "").trim() });
        index += match[0].length;
        continue;
      }
    }

    if (char === "!" && source[index + 1] === "[") {
      const match = IMAGE.exec(rest);
      if (match !== null) {
        push({
          kind: "image",
          src: match.groups?.src ?? "",
          alt: match.groups?.alt ?? "",
        });
        index += match[0].length;
        continue;
      }
    }

    if (char === "[") {
      const match = LINK.exec(rest);
      if (match !== null) {
        const label = match.groups?.text ?? "";
        push({
          kind: "link",
          href: match.groups?.href ?? "",
          children:
            depth >= MAX_DEPTH
              ? [{ kind: "text", text: label }]
              : parseInto(label, depth + 1),
        });
        index += match[0].length;
        continue;
      }
    }

    if (char === "<") {
      const match = AUTOLINK.exec(rest);
      if (match !== null) {
        const url = match.groups?.url ?? "";
        push({
          kind: "link",
          href: url,
          children: [{ kind: "text", text: url }],
        });
        index += match[0].length;
        continue;
      }
    }

    if (
      (char === "*" || char === "_") &&
      source.startsWith(char.repeat(2), index)
    ) {
      const match = STRONG.exec(rest);
      if (match !== null && (match.groups?.body ?? "").trim().length > 0) {
        const body = match.groups?.body ?? "";
        push({
          kind: "strong",
          children:
            depth >= MAX_DEPTH
              ? [{ kind: "text", text: body }]
              : parseInto(body, depth + 1),
        });
        index += match[0].length;
        continue;
      }
    }

    if (char === "~" && source.startsWith("~~", index)) {
      const match = STRIKE.exec(rest);
      if (match !== null && (match.groups?.body ?? "").trim().length > 0) {
        const body = match.groups?.body ?? "";
        push({
          kind: "strike",
          children:
            depth >= MAX_DEPTH
              ? [{ kind: "text", text: body }]
              : parseInto(body, depth + 1),
        });
        index += match[0].length;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const match = EMPHASIS.exec(rest);
      if (match !== null && (match.groups?.body ?? "").trim().length > 0) {
        const body = match.groups?.body ?? "";
        push({
          kind: "em",
          children:
            depth >= MAX_DEPTH
              ? [{ kind: "text", text: body }]
              : parseInto(body, depth + 1),
        });
        index += match[0].length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}
