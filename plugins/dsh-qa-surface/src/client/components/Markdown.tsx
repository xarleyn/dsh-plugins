import { Fragment, type ReactNode } from "react";

const INLINE = /(\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/gu;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u;
const ORDERED_LIST = /^\d{1,3}[.)]\s+/u;
const HORIZONTAL_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const BLOCK_START =
  /^(#{1,3})\s+|```|^[-*]\s+|^\d{1,3}[.)]\s+|^>\s|(?:^\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/u;

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

/** Split one GFM table row into trimmed cells, honoring escaped pipes. */
function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index] ?? "";
  if (!header.includes("|")) return false;
  return TABLE_SEPARATOR.test(lines[index + 1] ?? "");
}

function renderTable(
  lines: readonly string[],
  index: number,
): { node: ReactNode; next: number } {
  const header = splitTableRow(lines[index] ?? "");
  const aligns = splitTableRow(lines[index + 1] ?? "").map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    return right ? "right" : "left";
  });
  let cursor = index + 2;
  const rows: string[][] = [];
  while (
    cursor < lines.length &&
    (lines[cursor] ?? "").trim() !== "" &&
    (lines[cursor] ?? "").includes("|") &&
    !/^(#{1,3})\s+|```|^[-*]\s+|^\d{1,3}[.)]\s+|^>\s/u.test(lines[cursor] ?? "")
  ) {
    rows.push(splitTableRow(lines[cursor] ?? ""));
    cursor += 1;
  }
  return {
    node: (
      <div key={`table:${index}`} className="dsh-qa-md-table">
        <table>
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th
                  key={`h:${cellIndex}`}
                  style={{ textAlign: aligns[cellIndex] ?? "left" }}
                >
                  {inline(cell, `th:${index}:${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`r:${rowIndex}`}>
                {header.map((_, cellIndex) => (
                  <td
                    key={`d:${rowIndex}:${cellIndex}`}
                    style={{ textAlign: aligns[cellIndex] ?? "left" }}
                  >
                    {inline(
                      row[cellIndex] ?? "",
                      `td:${rowIndex}:${cellIndex}`,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    next: cursor,
  };
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
    if (isTableStart(lines, index)) {
      const table = renderTable(lines, index);
      blocks.push(table.node);
      index = table.next;
      continue;
    }
    if (HORIZONTAL_RULE.test(line)) {
      blocks.push(<hr key={`hr:${index}`} />);
      index += 1;
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
    if (ORDERED_LIST.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && ORDERED_LIST.test(lines[index] ?? "")) {
        const content = (lines[index] ?? "").replace(ORDERED_LIST, "");
        items.push(
          <li key={`oitem:${index}`}>{inline(content, `oitem:${index}`)}</li>,
        );
        index += 1;
      }
      blocks.push(<ol key={`olist:${index}`}>{items}</ol>);
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
      !BLOCK_START.test(lines[index] ?? "") &&
      !isTableStart(lines, index)
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
