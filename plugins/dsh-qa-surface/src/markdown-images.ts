import { parseMarkdown, type MarkdownBlock } from "./client/markdown/blocks.js";
import { parseInline, type MarkdownInline } from "./client/markdown/inline.js";

/** Exact image destinations from the same grammar the source preview renders. */
export function markdownImageTargets(text: string): ReadonlySet<string> {
  const doc = parseMarkdown(text);
  const targets = new Set<string>();
  const inline = (nodes: readonly MarkdownInline[]): void => {
    for (const node of nodes) {
      if (node.kind === "image") targets.add(node.src);
      else if ("children" in node) inline(node.children);
    }
  };
  const leaf = (text: string): void => inline(parseInline(text, doc));
  const blocks = (items: readonly MarkdownBlock[]): void => {
    for (const block of items) {
      if (block.kind === "paragraph" || block.kind === "heading")
        leaf(block.text);
      else if (block.kind === "quote") blocks(block.blocks);
      else if (block.kind === "list")
        block.items.forEach((item) => blocks(item.blocks));
      else if (block.kind === "table")
        [...block.head, ...block.rows.flat()].forEach(leaf);
    }
  };
  blocks(doc.blocks);
  for (const footnote of doc.footnotes.values()) blocks(footnote);
  return targets;
}
