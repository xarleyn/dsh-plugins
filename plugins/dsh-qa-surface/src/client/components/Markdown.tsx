import { Fragment, type ReactNode } from "react";

const INLINE = /(\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/gu;

function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > offset) nodes.push(text.slice(offset, index));
    const token = match[0];
    const key = `${keyPrefix}:${index}`;
    if (token.startsWith("[")) {
      const parts = /^\[([^\]]+)\]\(([^\s)]+)\)$/u.exec(token);
      const href = parts?.[2] === undefined ? undefined : safeHref(parts[2]);
      nodes.push(
        href === undefined ? (
          token
        ) : (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {parts?.[1]}
          </a>
        ),
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    offset = index + token.length;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes;
}

/** Deliberately small, HTML-free Markdown renderer for assistant-visible text. */
export function Markdown({ text }: { readonly text: string }) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code:${index}`}>
          <code data-language={language || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      const content = inline(heading[2] ?? "", `heading:${index}`);
      const key = `heading:${index}`;
      blocks.push(
        heading[1]?.length === 1 ? (
          <h2 key={key}>{content}</h2>
        ) : heading[1]?.length === 2 ? (
          <h3 key={key}>{content}</h3>
        ) : (
          <h4 key={key}>{content}</h4>
        ),
      );
      index += 1;
      continue;
    }
    if (/^[-*]\s+/u.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/u.test(lines[index] ?? "")) {
        const content = (lines[index] ?? "").replace(/^[-*]\s+/u, "");
        items.push(
          <li key={`item:${index}`}>{inline(content, `item:${index}`)}</li>,
        );
        index += 1;
      }
      blocks.push(<ul key={`list:${index}`}>{items}</ul>);
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(
        <blockquote key={`quote:${index}`}>
          {inline(line.slice(2), `quote:${index}`)}
        </blockquote>,
      );
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() !== "" &&
      !/^(#{1,3})\s+|^```|^[-*]\s+|^>\s/u.test(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(
      <p key={`paragraph:${index}`}>
        {paragraph.map((part, partIndex) => (
          <Fragment key={`line:${partIndex}`}>
            {partIndex === 0 ? null : <br />}
            {inline(part, `paragraph:${index}:${partIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
