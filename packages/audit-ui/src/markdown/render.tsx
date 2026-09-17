/**
 * Markdown → React elements.
 *
 * The renderer is the only place that decides what exists in the DOM, and its
 * rules are absolute (SPEC §62):
 *
 * - no `dangerouslySetInnerHTML`, anywhere;
 * - link and image destinations pass a protocol allowlist, so `javascript:`
 *   and `data:` are not links, they are text;
 * - an image that fails the allowlist renders as its alt text.
 */
import type { ReactNode } from "react";
import {
  parseBlocks,
  type HeadingDepth,
  type MarkdownBlock,
  type TableAlign,
} from "./blocks.js";
import { parseInline, type InlineNode } from "./inline.js";

/** Protocols a link or image destination may use. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * The destination, when it is safe to follow, else `undefined`.
 *
 * Relative destinations are resolved against nothing and therefore refused:
 * an audit is untrusted content, and a relative link in it has no meaningful
 * target in the DSH client.
 */
export function safeHref(raw: string): string | undefined {
  const candidate = raw.trim();
  if (candidate.length === 0) return undefined;
  try {
    const url = new URL(candidate);
    return SAFE_PROTOCOLS.has(url.protocol) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** A stable DOM id for a heading, from its text. */
export function headingAnchor(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return `audit-h-${index}${slug.length === 0 ? "" : `-${slug}`}`;
}

const DEPTH_TAG = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
} as const satisfies Record<HeadingDepth, string>;

const ALIGN_STYLE = {
  left: "left",
  center: "center",
  right: "right",
} as const satisfies Record<TableAlign, string>;

function renderInline(nodes: readonly InlineNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const nodeKey = `${key}.${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={nodeKey} className="dsh-audit-md__code">
            {node.text}
          </code>
        );
      case "strong":
        return (
          <strong key={nodeKey}>{renderInline(node.children, nodeKey)}</strong>
        );
      case "em":
        return <em key={nodeKey}>{renderInline(node.children, nodeKey)}</em>;
      case "strike":
        return <del key={nodeKey}>{renderInline(node.children, nodeKey)}</del>;
      case "link": {
        const href = safeHref(node.href);
        if (href === undefined) {
          // Not a link this client will follow. The label survives as text.
          return (
            <span key={nodeKey}>{renderInline(node.children, nodeKey)}</span>
          );
        }
        return (
          <a
            key={nodeKey}
            className="dsh-audit-md__link"
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {renderInline(node.children, nodeKey)}
          </a>
        );
      }
      case "image": {
        const src = safeHref(node.src);
        if (src === undefined) return <span key={nodeKey}>{node.alt}</span>;
        return (
          <img
            key={nodeKey}
            className="dsh-audit-md__image"
            src={src}
            alt={node.alt}
            loading="lazy"
          />
        );
      }
    }
  });
}

/** A counter that both the TOC and the body walk in the same order. */
interface HeadingCounter {
  n: number;
}

/** Render one block; headings consume the counter so their anchors match the TOC. */
function renderBlock(
  block: MarkdownBlock,
  key: string,
  counter: HeadingCounter,
): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return (
        <p key={key} className="dsh-audit-md__p">
          {renderInline(parseInline(block.text), key)}
        </p>
      );
    case "heading": {
      const Tag = DEPTH_TAG[block.depth];
      const id = headingAnchor(block.text, counter.n);
      counter.n += 1;
      return (
        <Tag key={key} id={id} className={`dsh-audit-md__h${block.depth}`}>
          {renderInline(parseInline(block.text), key)}
        </Tag>
      );
    }
    case "code":
      return (
        <pre key={key} className="dsh-audit-md__pre">
          <code data-lang={block.lang}>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="dsh-audit-md__quote">
          {block.blocks.map((child, index) =>
            renderBlock(child, `${key}.${index}`, counter),
          )}
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className="dsh-audit-md__list"
          {...(block.ordered && block.start !== 1
            ? { start: block.start }
            : {})}
        >
          {block.items.map((item, index) => (
            <li
              key={`${key}.${index}`}
              className={
                item.task
                  ? "dsh-audit-md__li dsh-audit-md__li--task"
                  : "dsh-audit-md__li"
              }
            >
              {item.task ? (
                <input
                  className="dsh-audit-md__task"
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  disabled
                />
              ) : null}
              {item.blocks.map((child, childIndex) =>
                renderBlock(child, `${key}.${index}.${childIndex}`, counter),
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div key={key} className="dsh-audit-md__table-wrap">
          <table className="dsh-audit-md__table">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    key={`${key}.h.${index}`}
                    style={{
                      textAlign: ALIGN_STYLE[block.align[index] ?? "left"],
                    }}
                  >
                    {renderInline(parseInline(cell), `${key}.h.${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}.r.${rowIndex}`}>
                  {block.head.map((_, cellIndex) => (
                    <td
                      key={`${key}.r.${rowIndex}.${cellIndex}`}
                      style={{
                        textAlign:
                          ALIGN_STYLE[block.align[cellIndex] ?? "left"],
                      }}
                    >
                      {renderInline(
                        parseInline(row[cellIndex] ?? ""),
                        `${key}.r.${rowIndex}.${cellIndex}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} className="dsh-audit-md__rule" />;
  }
}

/** One heading the table of contents links to. */
export interface MarkdownHeading {
  readonly id: string;
  readonly text: string;
  readonly depth: HeadingDepth;
}

/** A parsed report: its blocks and the headings among them. */
export interface ParsedReport {
  readonly blocks: readonly MarkdownBlock[];
  readonly headings: readonly MarkdownHeading[];
}

/** Parse a report once, for both the body and its table of contents. */
export function parseReport(source: string): ParsedReport {
  const blocks = parseBlocks(source);
  const headings: MarkdownHeading[] = [];
  let counter = 0;
  for (const block of blocks) {
    if (block.kind !== "heading") continue;
    const id = headingAnchor(block.text, counter);
    counter += 1;
    if (block.depth <= 3)
      headings.push({ id, text: block.text, depth: block.depth });
  }
  return { blocks, headings };
}

/** Render parsed blocks; headings get anchors so the TOC can link to them. */
export function renderReport(parsed: ParsedReport): ReactNode {
  const counter: HeadingCounter = { n: 0 };
  return parsed.blocks.map((block, index) =>
    renderBlock(block, `b${index}`, counter),
  );
}

/** Render Markdown directly, without a pre-parsed report. */
export function renderMarkdown(source: string): ReactNode {
  return renderReport(parseReport(source));
}
