import { Fragment, createElement } from "react";
import type { ReactNode } from "react";
import type { MarkdownBlock, MarkdownListItem } from "./blocks.js";
import { parseMarkdown } from "./blocks.js";
import { parseInline, type MarkdownInline } from "./inline.js";
import { CodeBlock, LinkGlyph } from "./CodeBlock.js";
import {
  codeChip,
  linkChip,
  safeHref,
  type MarkdownSourceContext,
} from "./source-chip.js";

/** One render pass: the owner's source vocabulary plus the document's targets. */
interface RenderContext extends MarkdownSourceContext {
  readonly definitions: ReadonlyMap<string, string>;
}

/**
 * Render markdown source as semantic React elements. Raw HTML never enters the
 * DOM (a tag is literal text), link and image destinations pass a protocol
 * allowlist, and a source the owning message knows about becomes a chip
 * instead of a plain link or code token.
 * @param text - Assistant-authored markdown.
 * @param context - Source resolution handed down by the owning message.
 * @returns The document's blocks.
 */
export function renderMarkdown(
  text: string,
  context: MarkdownSourceContext,
): ReactNode[] {
  const { blocks, definitions } = parseMarkdown(text);
  const pass: RenderContext = { ...context, definitions };
  return blocks.map((block, index) => renderBlock(block, `b${index}`, pass));
}

function renderBlock(
  block: MarkdownBlock,
  key: string,
  context: RenderContext,
): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p key={key}>{inline(block.text, key, context)}</p>;
    case "heading":
      return createElement(
        `h${block.depth}`,
        { key },
        ...inline(block.text, key, context),
      );
    case "code":
      return (
        <CodeBlock
          key={key}
          code={block.text}
          {...(block.lang === undefined ? {} : { lang: block.lang })}
        />
      );
    case "quote":
      return (
        <blockquote key={key}>
          {block.blocks.map((child, index) =>
            renderBlock(child, `${key}:${index}`, context),
          )}
        </blockquote>
      );
    case "list":
      return createElement(
        block.ordered ? "ol" : "ul",
        {
          key,
          ...(block.ordered && block.start !== 1 ? { start: block.start } : {}),
        },
        ...block.items.map((item, index) =>
          renderListItem(item, `${key}:${index}`, context, block.loose),
        ),
      );
    case "table":
      return renderTable(block, key, context);
    case "rule":
      return <hr key={key} />;
  }
}

function renderListItem(
  item: MarkdownListItem,
  key: string,
  context: RenderContext,
  loose: boolean,
): ReactNode {
  const [head, ...rest] = item.blocks;
  const parts: ReactNode[] = [];
  const checkbox = item.task ? (
    <input key="task" type="checkbox" checked={item.checked} disabled />
  ) : null;
  if (head !== undefined) {
    if (head.kind === "paragraph") {
      const body = (
        <>
          {checkbox}
          {checkbox === null ? null : " "}
          {inline(head.text, key, context)}
        </>
      );
      // A tight list unwraps every item paragraph, nested blocks or not.
      parts.push(
        loose ? <p key="0">{body}</p> : <Fragment key="0">{body}</Fragment>,
      );
    } else {
      if (checkbox !== null) parts.push(checkbox, " ");
      parts.push(renderBlock(head, `${key}:0`, context));
    }
  } else if (checkbox !== null) {
    parts.push(checkbox);
  }
  rest.forEach((block, index) => {
    parts.push(renderBlock(block, `${key}:${index + 1}`, context));
  });
  return (
    <li key={key} className={item.task ? "dsh-qa-md-task" : undefined}>
      {parts}
    </li>
  );
}

function renderTable(
  block: Extract<MarkdownBlock, { kind: "table" }>,
  key: string,
  context: RenderContext,
): ReactNode {
  return (
    <div key={key} className="dsh-qa-md-table">
      <table>
        <thead>
          <tr>
            {block.head.map((cell, index) => (
              <th
                key={`h:${index}`}
                style={{ textAlign: block.align[index] ?? "left" }}
              >
                {inline(cell, `${key}:h:${index}`, context)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`r:${rowIndex}`}>
              {block.head.map((_, cellIndex) => (
                <td
                  key={`d:${cellIndex}`}
                  style={{ textAlign: block.align[cellIndex] ?? "left" }}
                >
                  {inline(
                    row[cellIndex] ?? "",
                    `${key}:r:${rowIndex}:${cellIndex}`,
                    context,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inline(
  text: string,
  key: string,
  context: RenderContext,
): ReactNode[] {
  return inlineNodes(parseInline(text, context.definitions), key, context);
}

function inlineNodes(
  nodes: readonly MarkdownInline[],
  key: string,
  context: RenderContext,
): ReactNode[] {
  return nodes.map((node, index) => {
    const nodeKey = `${key}:${index}`;
    switch (node.kind) {
      case "text":
        return node.value;
      case "softbreak":
        // A single newline collapses to a space, exactly as CommonMark says.
        return "\n";
      case "break":
        return <br key={nodeKey} />;
      case "code": {
        const chip = codeChip(node.value, context);
        if (chip !== undefined)
          return <Fragment key={nodeKey}>{chip}</Fragment>;
        const href = inlineCodeUrl(node.value);
        return (
          <code key={nodeKey}>
            {href === undefined ? (
              node.value
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {node.value}
              </a>
            )}
          </code>
        );
      }
      case "strong":
        return (
          <strong key={nodeKey}>
            {children(node.children, nodeKey, context)}
          </strong>
        );
      case "em":
        return (
          <em key={nodeKey}>{children(node.children, nodeKey, context)}</em>
        );
      case "del":
        return (
          <del key={nodeKey}>{children(node.children, nodeKey, context)}</del>
        );
      case "link": {
        const href = safeHref(node.href);
        if (href === undefined) {
          return (
            <Fragment key={nodeKey}>
              {children(node.children, nodeKey, context)}
            </Fragment>
          );
        }
        const chip = linkChip(href, plainText(node.children), context);
        if (chip !== undefined) {
          return <Fragment key={nodeKey}>{chip}</Fragment>;
        }
        return (
          <a
            key={nodeKey}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <LinkGlyph />
            {children(node.children, nodeKey, context)}
          </a>
        );
      }
      case "image": {
        const src = remoteImage(node.src);
        if (src === undefined) {
          return (
            <span key={nodeKey} className="dsh-qa-md-image-alt">
              {node.alt}
            </span>
          );
        }
        return (
          <img
            key={nodeKey}
            className="dsh-qa-md-image"
            src={src}
            alt={node.alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        );
      }
    }
  });
}

function children(
  nodes: readonly MarkdownInline[],
  key: string,
  context: RenderContext,
): ReactNode[] {
  return inlineNodes(nodes, key, context);
}

/** The label text of a link, for the chip it may become. */
function plainText(nodes: readonly MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text" || node.kind === "code") return node.value;
      if (node.kind === "strong" || node.kind === "em" || node.kind === "del") {
        return plainText(node.children);
      }
      if (node.kind === "link") return plainText(node.children);
      return "";
    })
    .join("");
}

/** An inline-code token that is exactly an absolute HTTP(S) URL. */
function inlineCodeUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined;
  const href = safeHref(value);
  return href?.startsWith("http") === true ? href : undefined;
}

/** Images load from absolute HTTP(S) destinations only; anything else is alt text. */
function remoteImage(value: string): string | undefined {
  const href = safeHref(value);
  return href?.startsWith("http") === true ? href : undefined;
}
