/**
 * Confluence answers page bodies as Atlassian Document Format: a JSON tree of
 * typed nodes. Handing that tree to the model would spend the whole answer
 * budget on wrappers, so it is flattened into markdown-like text here.
 *
 * The flattening is deliberately defensive. Anything the provider cannot render
 * — a macro, an embedded view, a media reference — becomes a placeholder: the
 * provider never fetches what a page points at, never renders it, and never
 * lets page content choose what happens next.
 */

/** A node deeper than this is not walked; the wrapper is dropped instead. */
const MAX_DEPTH = 64;

/** Tab and the two line endings survive; every other control character does not. */
const KEPT_CONTROL_CHARS = new Set([0x09, 0x0a, 0x0d]);

/** Block nodes inside a list item are rendered as blocks, not as a first line. */
const BLOCK_TYPES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "decisionList",
  "codeBlock",
  "table",
  "blockquote",
  "panel",
  "expand",
  "nestedExpand",
  "mediaSingle",
  "mediaGroup",
  "layoutSection",
  "rule",
]);

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childNodes(node: Node): Node[] {
  const content = node["content"];
  return Array.isArray(content) ? content.filter(isNode) : [];
}

function attrs(node: Node): Node {
  const value = node["attrs"];
  return isNode(value) ? value : {};
}

/**
 * A node field as text. Rendering reads many optional attributes, so an absent
 * one is the empty string here — the same default the Jira renderer keeps.
 */
function fieldText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A node field as a finite number, only when the document carried one. */
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function typeOf(node: Node): string {
  return fieldText(node["type"]);
}

/**
 * Control characters carry no meaning in a document body and would only be
 * noise in an answer, so they are dropped; asking a regular expression to do it
 * reads as a control-character range and lint refuses it, which is why this is
 * a plain walk.
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

/** The provider's stand-in for a Confluence macro it does not execute. */
function macroPlaceholder(node: Node): string {
  const marks = attrs(node);
  const key =
    fieldText(marks["extensionKey"]) ||
    fieldText(marks["extensionType"]) ||
    fieldText(node["type"]);
  return `[Confluence macro: ${flatten(key)}]`;
}

/** Marks are applied in a fixed order, so the same node always reads the same. */
function marks(text: string, node: Node): string {
  const value = node["marks"];
  if (!Array.isArray(value)) return text;
  const list = value.filter(isNode);
  const kinds = new Set(list.map((mark) => fieldText(mark["type"])));
  let result = text;
  if (kinds.has("code")) result = `\`${result}\``;
  if (kinds.has("strong")) result = `**${result}**`;
  if (kinds.has("em")) result = `*${result}*`;
  if (kinds.has("strike")) result = `~~${result}~~`;
  if (kinds.has("underline")) result = `_${result}_`;
  const link = list.find((mark) => fieldText(mark["type"]) === "link");
  if (link !== undefined) {
    const href = flatten(fieldText(attrs(link)["href"]));
    if (href !== "") return `[${result}](${href})`;
  }
  return result;
}

/** One inline node with its marks; the recursion stops at the depth ceiling. */
function inlineNode(node: Node, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  return marks(inline(node, depth), node);
}

/** Inline content of a node: text, mentions, statuses and the words of a macro. */
function inline(node: Node, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  const type = typeOf(node);
  if (type === "text") return flatten(fieldText(node["text"]));
  if (type === "hardBreak") return "\n";
  if (type === "mention") {
    const marks_ = attrs(node);
    return fieldText(marks_["text"]) || `@${fieldText(marks_["id"])}`;
  }
  if (type === "emoji") {
    const marks_ = attrs(node);
    return fieldText(marks_["text"]) || fieldText(marks_["shortName"]);
  }
  if (type === "status") {
    return `[status: ${flatten(fieldText(attrs(node)["text"]))}]`;
  }
  if (type === "inlineCard" || type === "blockCard" || type === "embedCard") {
    return flatten(fieldText(attrs(node)["url"]));
  }
  if (type === "media") {
    const marks_ = attrs(node);
    const label = fieldText(marks_["alt"]) || fieldText(marks_["id"]);
    return `[media: ${flatten(label)}]`;
  }
  if (type === "inlineExtension" || type === "extension") {
    return macroPlaceholder(node);
  }
  if (type === "date") return fieldText(attrs(node)["timestamp"]);
  // Everything else at text level is either unknown or a block that ended up
  // here; rendering its children keeps the words and loses only the wrapper.
  return inlineChildren(node, depth);
}

/** Inline children joined without separators, each with its own marks. */
function inlineChildren(node: Node, depth: number): string {
  return childNodes(node)
    .map((child) => inlineNode(child, depth + 1))
    .join("");
}

/** List items, with the text aligned under the marker of each item. */
function listItems(node: Node, depth: number, ordered: boolean): string {
  const start = asNumber(attrs(node)["order"]) ?? 1;
  const indent = "  ".repeat(depth);
  return childNodes(node)
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const pad = " ".repeat(marker.length);
      const [head, ...rest] = childNodes(item);
      const lines: string[] = [];
      if (head !== undefined) {
        lines.push(
          BLOCK_TYPES.has(typeOf(head))
            ? block(head, depth)
            : inlineNode(head, depth + 1),
        );
      }
      for (const child of rest) lines.push(block(child, depth));
      return lines
        .filter((line) => line !== "")
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

function tasks(node: Node, depth: number): string {
  const indent = "  ".repeat(depth);
  return childNodes(node)
    .map((item) => {
      const done = fieldText(attrs(item)["state"]) === "DONE";
      return `${indent}- [${done ? "x" : " "}] ${inlineChildren(item, depth + 1)}`;
    })
    .join("\n");
}

function cell(node: Node, depth: number): string {
  const text = childNodes(node)
    .map((child) => block(child, depth + 1))
    .filter((part) => part !== "")
    .join(" ");
  // A pipe would end the cell early, and a line break has no meaning inside one.
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function table(node: Node, depth: number): string {
  const lines: string[] = [];
  childNodes(node)
    .filter((row) => typeOf(row) === "tableRow")
    .forEach((row, index) => {
      const cells = childNodes(row).map((item) => cell(item, depth + 1));
      if (cells.length === 0) return;
      lines.push(`| ${cells.join(" | ")} |`);
      const header =
        index === 0 &&
        childNodes(row).every((item) => typeOf(item) === "tableHeader");
      if (header) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
  return lines.join("\n");
}

/** One block-level node as text; an empty string when the node carries nothing. */
function block(node: Node, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  const type = typeOf(node);
  // A macro or a generator can leave an inline node where a block was expected;
  // rendering it as text keeps the words instead of dropping them.
  if (
    type === "text" ||
    type === "mention" ||
    type === "status" ||
    type === "emoji" ||
    type === "date" ||
    type === "inlineCard" ||
    type === "media" ||
    type === "hardBreak"
  ) {
    return inlineNode(node, depth);
  }
  switch (type) {
    case "paragraph":
      return inlineChildren(node, depth);
    case "heading": {
      const level = asNumber(attrs(node)["level"]) ?? 1;
      const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
      return `${hashes} ${inlineChildren(node, depth)}`;
    }
    case "bulletList":
      return listItems(node, depth, false);
    case "orderedList":
      return listItems(node, depth, true);
    case "taskList":
      return tasks(node, depth);
    case "decisionList":
      return childNodes(node)
        .map(
          (item) =>
            `${"  ".repeat(depth)}- [decision] ${inlineChildren(item, depth + 1)}`,
        )
        .join("\n");
    case "codeBlock": {
      const language = flatten(fieldText(attrs(node)["language"]));
      const code = childNodes(node)
        .map((child) =>
          typeOf(child) === "text" ? fieldText(child["text"]) : "",
        )
        .join("")
        .replace(/\n+$/u, "");
      return `\`\`\`${language}\n${flatten(code)}\n\`\`\``;
    }
    case "blockquote":
      return blocks(childNodes(node), depth + 1)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "rule":
      return "---";
    case "panel": {
      const kind = flatten(fieldText(attrs(node)["panelType"]));
      const inner = blocks(childNodes(node), depth + 1).join("\n\n");
      return inner === "" ? `[panel: ${kind}]` : `[panel: ${kind}]\n${inner}`;
    }
    case "expand":
    case "nestedExpand": {
      const title = flatten(fieldText(attrs(node)["title"]));
      const inner = blocks(childNodes(node), depth + 1).join("\n\n");
      const head = title === "" ? "[expand]" : `[expand: ${title}]`;
      return inner === "" ? head : `${head}\n${inner}`;
    }
    case "table":
      return table(node, depth);
    case "layoutSection":
    case "layoutColumn":
    case "layout":
      return blocks(childNodes(node), depth + 1).join("\n\n");
    case "mediaSingle":
    case "mediaGroup":
      return inlineChildren(node, depth) || "[media]";
    case "bodiedExtension":
    case "multiBodiedExtension":
      return [
        macroPlaceholder(node),
        blocks(childNodes(node), depth + 1).join("\n\n"),
      ]
        .filter((part) => part !== "")
        .join("\n");
    case "extension":
    case "inlineExtension":
      return macroPlaceholder(node);
    default:
      // Unknown block: keep the words, drop the wrapper we cannot vouch for.
      return blocks(childNodes(node), depth + 1).join("\n\n");
  }
}

function blocks(nodes: readonly Node[], depth: number): string[] {
  return nodes.map((node) => block(node, depth)).filter((part) => part !== "");
}

/**
 * `body.atlas_doc_format.value` arrives as a JSON string in both REST versions;
 * an object is accepted too, so a caller that already parsed it is not punished.
 */
function adfDocument(value: unknown): Node | undefined {
  if (isNode(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isNode(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The document body as markdown-like text, or an empty string when unknown. */
export function adfToText(value: unknown): string {
  const document = adfDocument(value);
  if (document === undefined) return "";
  return blocks(childNodes(document), 0)
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Character budget for one body. What does not fit is cut and said to be cut;
 * the model can ask for a wider budget, up to the deployment ceiling.
 */
export function textBudget(
  text: string,
  limit: number,
): {
  readonly text: string;
  readonly totalChars: number;
  readonly truncated: boolean;
} {
  const totalChars = text.length;
  if (totalChars <= limit) return { text, totalChars, truncated: false };
  return {
    text: text.slice(0, Math.max(limit, 0)),
    totalChars,
    truncated: true,
  };
}
