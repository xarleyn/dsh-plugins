/**
 * Atlassian Document Format is Jira's rich-text body: descriptions, comments and
 * rich custom fields arrive as a JSON tree of `doc`/`paragraph`/`text` nodes.
 * The model asks for text, not for a tree, so this converter renders the
 * structure into markdown-like lines — headings, lists, code, links, tables,
 * mentions — and never fetches anything a node points at: an embedded card or a
 * media node becomes a marker, not a request.
 *
 * The render is a pure function of an already size-bounded payload (the
 * transport caps the body it reads), so it can build the whole text and cut it
 * once, instead of threading a budget through every recursion.
 */
export interface AdfText {
  readonly text: string;
  readonly truncated: boolean;
}

interface Node {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
  readonly marks?: unknown;
  readonly attrs?: unknown;
}

const LANGUAGE = /^[A-Za-z0-9+#._-]{0,32}$/u;

/** A value that is an ADF document rather than a plain string. */
export function isAdf(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["type"] === "doc"
  );
}

function node(value: unknown): Node {
  return typeof value === "object" && value !== null ? (value as Node) : {};
}

function attrs(value: unknown): Record<string, unknown> {
  const source = node(value).attrs;
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)
    : {};
}

/**
 * A field of an ADF node as text. Rendering reads many optional attributes, so
 * an absent one is the empty string here: the markup reads `shortName === ""`
 * to decide what to write, and a projection is not the caller of this reader.
 */
function fieldText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function children(value: unknown): unknown[] {
  return Array.isArray(node(value).content)
    ? (node(value).content as unknown[])
    : [];
}

function typeOf(value: unknown): string {
  const type = node(value).type;
  return typeof type === "string" ? type : "";
}

/** Inline content of one block, rendered onto a single line. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => inline(item)).join("");
  const current = node(value);
  const type = typeOf(current);
  if (type === "text") {
    const text = typeof current.text === "string" ? current.text : "";
    return marked(text, current.marks);
  }
  if (type === "hardBreak") return "\n";
  if (type === "mention") {
    const source = attrs(current);
    return `@${fieldText(source, "text") || fieldText(source, "id")}`;
  }
  if (type === "emoji") {
    const source = attrs(current);
    const shortName = fieldText(source, "shortName");
    return shortName === "" ? fieldText(source, "text") : `:${shortName}:`;
  }
  if (type === "date") {
    const stamp = attrs(current)["timestamp"];
    const parsed = typeof stamp === "number" ? new Date(stamp) : undefined;
    return parsed === undefined || Number.isNaN(parsed.getTime())
      ? "[date]"
      : parsed.toISOString().slice(0, 10);
  }
  if (type === "status") return `\`${fieldText(attrs(current), "text")}\``;
  if (type === "inlineCard" || type === "blockCard" || type === "embedCard") {
    // The URL is shown as text; nothing here is ever fetched.
    return `<${fieldText(attrs(current), "url")}>`;
  }
  if (
    type === "media" ||
    type === "mediaInline" ||
    type === "mediaSingle" ||
    type === "mediaGroup"
  ) {
    const source = attrs(current);
    const label = fieldText(source, "alt") || fieldText(source, "id");
    const marker = `[media: ${label === "" ? "without name" : label}]`;
    return `${marker}${inline(current.content)}`;
  }
  if (type === "placeholder") {
    return `[placeholder: ${fieldText(attrs(current), "text")}]`;
  }
  if (
    type === "inlineExtension" ||
    type === "extension" ||
    type === "bodiedExtension"
  ) {
    return `[app: ${fieldText(attrs(current), "extensionKey") || "unknown"}]`;
  }
  // A node nothing here knows: keep its inline content, and stop on a leaf
  // rather than walking into an empty body forever.
  return current.content === undefined ? "" : inline(current.content);
}

function marked(text: string, marks: unknown): string {
  if (!Array.isArray(marks)) return text;
  let rendered = text;
  for (const entry of marks) {
    const mark = node(entry);
    const type = typeOf(mark);
    if (type === "code") rendered = `\`${rendered}\``;
    else if (type === "strong") rendered = `**${rendered}**`;
    else if (type === "em") rendered = `_${rendered}_`;
    else if (type === "strike") rendered = `~~${rendered}~~`;
    else if (type === "link") {
      const href = fieldText(attrs(mark), "href");
      rendered = href === "" ? rendered : `[${rendered}](${href})`;
    }
  }
  return rendered;
}

/** One list item: its first line keeps the bullet, the rest is indented. */
function withBullet(marker: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [marker.trimEnd()];
  return [marker + lines[0], ...lines.slice(1).map((line) => `  ${line}`)];
}

function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => `${prefix}${line}`);
}

/** Block content of one node, one string per line. */
function blocks(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => blocks(item));
  const current = node(value);
  const type = typeOf(current);
  if (
    type === "doc" ||
    type === "blockquote" ||
    type === "mediaSingle" ||
    type === "mediaGroup"
  ) {
    return children(current).flatMap((child) => blocks(child));
  }
  if (type === "paragraph") return [inline(current.content)];
  if (type === "heading") {
    const level = Number(attrs(current)["level"]);
    const hashes = "#".repeat(
      Number.isInteger(level) && level >= 1 && level <= 6 ? level : 3,
    );
    return [`${hashes} ${inline(current.content)}`];
  }
  if (type === "codeBlock") {
    const language = fieldText(attrs(current), "language");
    return [
      `\`\`\`${LANGUAGE.test(language) ? language : ""}`,
      inline(current.content),
      "```",
    ];
  }
  if (type === "rule") return ["---"];
  if (type === "panel") {
    const panel = fieldText(attrs(current), "panelType");
    const body = indent(
      children(current).flatMap((child) => blocks(child)),
      "> ",
    );
    return panel === "" ? body : [`> [${panel}]`, ...body];
  }
  if (type === "bulletList" || type === "orderedList") {
    const ordered = type === "orderedList";
    const start = Number(attrs(current)["order"]);
    return children(current).flatMap((item, index) => {
      const number =
        ordered && Number.isInteger(start) && start > 0
          ? String(start + index)
          : String(index + 1);
      const marker = ordered ? `${number}. ` : "- ";
      const body = node(item);
      const inner: string[] = [];
      for (const child of children(body)) {
        const childType = typeOf(child);
        if (childType === "bulletList" || childType === "orderedList") {
          inner.push(...blocks(child));
        } else if (childType === "paragraph") {
          inner.push(inline(node(child).content));
        } else {
          inner.push(...blocks(child));
        }
      }
      return withBullet(marker, inner);
    });
  }
  if (type === "listItem")
    return children(current).flatMap((child) => blocks(child));
  if (type === "taskList") {
    return children(current).flatMap((item) => {
      const done = fieldText(attrs(item), "state") === "DONE";
      return [`- [${done ? "x" : " "}] ${inline(node(item).content)}`];
    });
  }
  if (type === "decisionList") {
    return children(current).flatMap((item) => [
      `- [decision] ${inline(node(item).content)}`,
    ]);
  }
  if (type === "table") {
    const rows = children(current);
    const lines: string[] = [];
    rows.forEach((row, index) => {
      const cells = children(row).map((cell) => inline(node(cell).content));
      lines.push(`| ${cells.join(" | ")} |`);
      if (index === 0) {
        lines.push(`|${" --- |".repeat(Math.max(cells.length, 1))}`);
      }
    });
    return lines;
  }
  if (type === "expand" || type === "nestedExpand") {
    return [
      `[expand: ${fieldText(attrs(current), "title") || "without title"}]`,
      ...indent(
        children(current).flatMap((child) => blocks(child)),
        "> ",
      ),
    ];
  }
  // Unknown node: keep whatever it holds rather than dropping the text.
  const inner = children(current).flatMap((child) => blocks(child));
  return inner.length > 0 ? inner : [inline(current)];
}

/** Render an ADF document to bounded markdown-like text. */
export function adfToText(value: unknown, maxChars: number): AdfText {
  const lines = blocks(value)
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .filter((line, index, all) => line !== "" || all[index - 1] !== "");
  return truncate(lines.join("\n").trim(), maxChars);
}

function truncate(text: string, maxChars: number): AdfText {
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

/**
 * Text of a body that may be ADF or a plain string, bounded by the deployment
 * limit. Jira answers both: older issues and some custom fields carry plain
 * text, while Cloud writes ADF.
 */
export function bodyText(value: unknown, maxChars: number): AdfText {
  if (typeof value === "string") return truncate(value.trim(), maxChars);
  if (isAdf(value)) return adfToText(value, maxChars);
  return { text: "", truncated: false };
}
