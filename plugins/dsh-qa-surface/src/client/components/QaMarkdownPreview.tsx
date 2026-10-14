import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { MarkdownFrontmatter } from "../../markdown-frontmatter.js";
import { renderMarkdown } from "../markdown/render.js";

const LABELS: Readonly<Record<string, string>> = {
  domain: "Область",
  corpus: "Корпус",
  applies_to: "Версии",
  document_type: "Тип документа",
  audience: "Аудитория",
  language: "Язык",
  status: "Статус",
  section: "Раздел",
  source: "Исходные файлы",
  conversion: "Подготовка документа",
  id: "Идентификатор",
  version_confidence: "Определение версии",
  parent_id: "Родительский документ",
  supersedes: "Заменяет",
  superseded_by: "Заменён",
  related_domains: "Связанные области",
};

function valueText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (depth > 6) return "…";
  if (Array.isArray(value))
    return value.map((item) => valueText(item, depth + 1)).join(", ");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${valueText(item, depth + 1)}`)
      .join(" · ");
  return "—";
}

function Metadata({
  fields,
}: {
  readonly fields: Readonly<Record<string, unknown>>;
}) {
  const basic = [
    "applies_to",
    "document_type",
    "audience",
    "language",
    "status",
    "domain",
    "corpus",
  ];
  const details = Object.entries(fields).filter(
    ([key, value]) =>
      !["title", "section", "part", "parts", ...basic].includes(key) &&
      value !== null,
  );
  return (
    <header className="dsh-qa-docmeta" data-testid="qa-source-frontmatter">
      {typeof fields.title === "string" ? (
        <h2>{fields.title}</h2>
      ) : (
        <h2>О документе</h2>
      )}
      <dl className="dsh-qa-docmeta__attributes">
        {basic
          .filter((key) => fields[key] != null)
          .map((key) => (
            <div key={key}>
              <dt>{LABELS[key] ?? key}</dt>
              <dd>{valueText(fields[key])}</dd>
            </div>
          ))}
      </dl>
      {fields.part == null ? null : (
        <p>
          Часть {valueText(fields.part)}
          {fields.parts == null ? "" : ` из ${valueText(fields.parts)}`}
        </p>
      )}
      {typeof fields.section === "string" ? <p>{fields.section}</p> : null}
      {details.length === 0 ? null : (
        <details data-testid="qa-source-frontmatter-details">
          <summary>Сведения об источнике</summary>
          <dl>
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>{LABELS[key] ?? key}</dt>
                <dd>
                  <MetadataValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </header>
  );
}

function MetadataValue({
  value,
  depth = 0,
}: {
  readonly value: unknown;
  readonly depth?: number;
}): ReactNode {
  if (depth > 6 || value === null || typeof value !== "object")
    return valueText(value);
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <MetadataValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  return (
    <dl>
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            <MetadataValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Source-only rendering: original file line numbers survive frontmatter removal. */
export function QaMarkdownPreview({
  text,
  renderFrontmatter,
  frontmatter,
  lineStart,
  lineEnd,
  renderImage,
  requestKey,
}: {
  readonly text: string;
  readonly renderFrontmatter: boolean;
  readonly frontmatter?: MarkdownFrontmatter;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly renderImage?: (src: string, alt: string) => ReactNode;
  readonly requestKey?: unknown;
}) {
  const root = useRef<HTMLDivElement>(null);
  const header = renderFrontmatter ? frontmatter : undefined;
  const children = useMemo(
    () =>
      renderMarkdown(
        header?.body ?? text,
        renderImage === undefined ? {} : { renderImage },
        {},
        {
          offset: header?.offset ?? 0,
          ...(lineStart === undefined ? {} : { start: lineStart }),
          ...(lineEnd === undefined ? {} : { end: lineEnd }),
        },
      ),
    [text, header, lineStart, lineEnd, renderImage],
  );
  useEffect(() => {
    if (lineStart === undefined) return;
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        "[data-source-line-start]",
      ) ?? []),
    ];
    const target =
      nodes.find((node) => Number(node.dataset.sourceLineEnd) >= lineStart) ??
      nodes.at(-1);
    target?.scrollIntoView?.({ block: "center" });
  }, [children, lineStart, requestKey]);
  const headerHighlight =
    lineStart !== undefined &&
    header !== undefined &&
    lineStart <= header.offset;
  return (
    <div ref={root} className="dsh-qa-md">
      {header === undefined ? null : (
        <div
          data-source-line-start={1}
          data-source-line-end={header.offset}
          className={
            headerHighlight ? "dsh-qa-preview__block--highlight" : undefined
          }
        >
          <Metadata fields={header.fields} />
        </div>
      )}
      {children}
    </div>
  );
}
