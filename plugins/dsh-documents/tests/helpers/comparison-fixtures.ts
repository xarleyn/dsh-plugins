/**
 * OOXML fixture builders for the comparison tests.
 *
 * The comparison reads the package itself, so the tests need packages, not
 * stubs of them: real ZIP containers whose `word/document.xml` really carries
 * the paragraphs, tables, headers, footnotes and revisions a Word writer would
 * produce. Building them here keeps binary fixtures out of the repository and
 * keeps every assertion about a file the extractor could genuinely meet.
 */

import type { ZipEntryInput } from "./document-fixtures.js";
import { buildZip } from "./document-fixtures.js";

const W_NAMESPACE =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface DocxPackageParts {
  readonly body: string;
  /** Extra parts, keyed by their name inside the package. */
  readonly extra?: Readonly<Record<string, string | Buffer>>;
  readonly styles?: string;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/** A DOCX package whose body is the XML fragment given. */
export function docxWithBody(parts: DocxPackageParts): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NAMESPACE}"><w:body>${parts.body}</w:body></w:document>`;
  const entries: ZipEntryInput[] = [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: "<Relationships/>" },
    { name: "word/document.xml", data: document },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Fixture</dc:title></cp:coreProperties>`,
    },
  ];
  if (parts.styles !== undefined) {
    entries.push({ name: "word/styles.xml", data: parts.styles });
  }
  for (const [name, data] of Object.entries(parts.extra ?? {})) {
    entries.push({ name, data });
  }
  return buildZip(entries);
}

/** A paragraph of plain text. */
export function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** A paragraph styled as a heading. */
export function heading(text: string, level: number): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** A paragraph that carries an explicit outline level instead of a style. */
export function outlined(text: string, level: number): string {
  return `<w:p><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** A numbered or bulleted list item. */
export function listItem(text: string, level = 0): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** A paragraph whose runs carry the given properties. */
export function formatted(text: string, properties: readonly string[]): string {
  const runProperties = properties.map((name) => `<w:${name}/>`).join("");
  return `<w:p><w:r><w:rPr>${runProperties}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
}

/** A table with the given grid, `gridSpan` honoured for a merged cell. */
export function table(
  rows: readonly (readonly string[])[],
  options: { readonly spanFirstCell?: number } = {},
): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, column) => {
          const span =
            rowIndex === 0 &&
            column === 0 &&
            options.spanFirstCell !== undefined
              ? `<w:tcPr><w:gridSpan w:val="${options.spanFirstCell}"/></w:tcPr>`
              : "";
          return `<w:tc>${span}${paragraph(cell)}</w:tc>`;
        })
        .join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl>${body}</w:tbl>`;
}

/** A tracked insertion: text that is part of the document as it stands. */
export function trackedInsertion(
  text: string,
  author = "Reviewer",
  date = "2026-09-14T10:00:00Z",
): string {
  return `<w:p><w:r><w:t xml:space="preserve">Основание: </w:t></w:r><w:ins w:id="1" w:author="${author}" w:date="${date}"><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
}

/** A tracked deletion: text Word shows as struck through, not as text. */
export function trackedDeletion(
  text: string,
  author = "Reviewer",
  date = "2026-09-14T11:00:00Z",
): string {
  return `<w:p><w:r><w:t xml:space="preserve">Срок: </w:t></w:r><w:del w:id="2" w:author="${author}" w:date="${date}"><w:r><w:delText>${text}</w:delText></w:r></w:del><w:r><w:t>30 дней</w:t></w:r></w:p>`;
}

/** A header or footer part holding the given body fragment. */
export function headerPart(body: string, root: "hdr" | "ftr" = "hdr"): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${root} xmlns:w="${W_NAMESPACE}">${body}</w:${root}>`;
}

/** A footnotes part: `separator` entries plus the notes themselves. */
export function footnotesPart(
  notes: readonly { readonly id: number; readonly text: string }[],
): string {
  const separator =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>';
  const body = notes
    .map(
      (note) =>
        `<w:footnote w:id="${note.id}">${paragraph(note.text)}</w:footnote>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W_NAMESPACE}">${separator}${body}</w:footnotes>`;
}

/** A comments part. */
export function commentsPart(
  comments: readonly {
    readonly id: number;
    readonly author: string;
    readonly text: string;
  }[],
): string {
  const body = comments
    .map(
      (comment) =>
        `<w:comment w:id="${comment.id}" w:author="${comment.author}" w:date="2026-09-14T12:00:00Z">${paragraph(comment.text)}</w:comment>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W_NAMESPACE}">${body}</w:comments>`;
}

/** A styles part mapping a style id onto a heading level. */
export function stylesPart(
  styles: readonly { readonly id: string; readonly level: number }[],
): string {
  const body = styles
    .map(
      (style) =>
        `<w:style w:type="paragraph" w:styleId="${style.id}"><w:name w:val="${style.id}"/><w:pPr><w:outlineLvl w:val="${style.level - 1}"/></w:pPr></w:style>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NAMESPACE}">${body}</w:styles>`;
}

/** A relationship part pointing at an external target. */
export function externalRelationshipPart(target: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`;
}
