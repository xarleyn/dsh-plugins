/**
 * Native DOCX extraction (§11, §12, §27).
 *
 * The extractor's contract is "the package decides", so these tests assert what
 * the package said: paragraph boundaries, table grid coordinates, heading
 * levels from styles or outline levels, headers, footers, footnotes, comments,
 * and tracked revisions that count as text only on the insertion side.
 */

import { describe, expect, test } from "vitest";

import { extractDocx } from "../src/documents/comparison/extractors/docx.js";
import { DocumentError } from "../src/documents/errors.js";
import {
  parseXml,
  XmlParseError,
} from "../src/documents/comparison/ooxml/xml.js";
import {
  commentsPart,
  docxWithBody,
  externalRelationshipPart,
  footnotesPart,
  formatted,
  headerPart,
  heading,
  listItem,
  outlined,
  paragraph,
  stylesPart,
  table,
  trackedDeletion,
  trackedInsertion,
} from "./helpers/comparison-fixtures.js";

function extract(
  bytes: Buffer,
  overrides: {
    readonly ignoreFormatting?: boolean;
    readonly maxNodes?: number;
    readonly maxUncompressedBytes?: number;
  } = {},
) {
  return extractDocx({
    filename: "contract.docx",
    inputPath: "contract.docx",
    bytes,
    ignoreFormatting: overrides.ignoreFormatting ?? true,
    maxNodes: overrides.maxNodes ?? 10_000,
    maxUncompressedBytes: overrides.maxUncompressedBytes ?? 64 * 1024 * 1024,
  });
}

function codeOf(body: () => unknown): string {
  try {
    body();
  } catch (error) {
    if (error instanceof DocumentError) return error.code;
    throw error;
  }
  throw new Error("the call did not fail");
}

describe("document structure", () => {
  test("paragraphs, headings and list items become nodes of their own", () => {
    const document = extract(
      docxWithBody({
        body:
          heading("5. Стоимость", 1) +
          heading("5.2 Порядок оплаты", 2) +
          paragraph("Оплата производится в течение 10 рабочих дней.") +
          listItem("Счёт-фактура предоставляется ежемесячно."),
      }),
    );
    expect(document.kind).toBe("native-docx");
    expect(document.counts.headings).toBe(2);
    const types = document.nodes.map((node) => node.type);
    expect(types).toEqual(["heading", "heading", "paragraph", "list-item"]);
    const payment = document.nodes[2];
    expect(payment?.path).toEqual(["5. Стоимость", "5.2 Порядок оплаты"]);
    expect(payment?.rawText).toBe(
      "Оплата производится в течение 10 рабочих дней.",
    );
    expect(document.nodes[3]?.level).toBe(1);
  });

  test("heading levels come from styles or from an outline level", () => {
    const document = extract(
      docxWithBody({
        body: outlined("A. Общие положения", 1) + outlined("A.1. Термины", 2),
        styles: stylesPart([{ id: "Clause", level: 3 }]),
      }),
    );
    expect(document.nodes.map((node) => node.level)).toEqual([1, 2]);
    const styled = extract(
      docxWithBody({
        body: paragraph("Текст."),
        styles: stylesPart([{ id: "Clause", level: 3 }]),
      }),
    );
    expect(styled.counts.nodes).toBe(1);
  });

  test("breaks and tabs are text, field codes and drawings are not", () => {
    const document = extract(
      docxWithBody({
        body:
          "<w:p><w:r><w:t>Первая строка</w:t><w:br/><w:t>вторая</w:t><w:tab/><w:t>после таба</w:t></w:r>" +
          "<w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>",
      }),
    );
    expect(document.nodes[0]?.rawText).toBe("Первая строка\nвторая после таба");
  });

  test("empty paragraphs are dropped, so page breaks are not nodes", () => {
    const document = extract(
      docxWithBody({
        body: paragraph("") + paragraph("Текст.") + paragraph(""),
      }),
    );
    expect(document.nodes).toHaveLength(1);
  });
});

describe("tables (§27)", () => {
  test("a table keeps its rows, cells and coordinates", () => {
    const document = extract(
      docxWithBody({
        body:
          paragraph("Смета:") +
          table([
            ["Позиция", "Сумма"],
            ["Лицензия", "500 000 ₽"],
          ]),
      }),
    );
    const node = document.nodes.find((entry) => entry.type === "table");
    expect(node).toBeDefined();
    expect(node?.table?.rows).toHaveLength(2);
    expect(node?.table?.rows[1]?.cells.map((cell) => cell.rawText)).toEqual([
      "Лицензия",
      "500 000 ₽",
    ]);
    expect(node?.table?.rows[1]?.cells[1]?.source).toMatchObject({
      table: 1,
      row: 1,
      column: 1,
    });
  });

  test("a merged cell advances the column counter", () => {
    const document = extract(
      docxWithBody({
        body: table(
          [
            ["Заголовок на две колонки", "C"],
            ["A", "B", "C"],
          ],
          { spanFirstCell: 2 },
        ),
      }),
    );
    const rows = document.nodes[0]?.table?.rows ?? [];
    expect(rows[0]?.cells.map((cell) => cell.column)).toEqual([0, 2]);
    expect(rows[1]?.cells.map((cell) => cell.column)).toEqual([0, 1, 2]);
  });

  test("a cell with several paragraphs joins them", () => {
    const document = extract(
      docxWithBody({
        body: `<w:tbl><w:tr><w:tc>${paragraph("Первая строка.")}${paragraph("Вторая строка.")}</w:tc></w:tr></w:tbl>`,
      }),
    );
    expect(document.nodes[0]?.table?.rows[0]?.cells[0]?.rawText).toBe(
      "Первая строка. Вторая строка.",
    );
  });
});

describe("headers, footers, footnotes and comments (§5.1 scope)", () => {
  test("parts land in their own document part", () => {
    const document = extract(
      docxWithBody({
        body: paragraph("Текст договора."),
        extra: {
          "word/header1.xml": headerPart(paragraph("ООО «Демо-продукт»")),
          "word/footer2.xml": headerPart(paragraph("Стр. 1 из 10"), "ftr"),
          "word/footnotes.xml": footnotesPart([
            { id: 1, text: "Определение термина." },
          ]),
          "word/comments.xml": commentsPart([
            { id: 1, author: "Юрист", text: "Уточнить срок." },
          ]),
        },
      }),
    );
    const byPart = new Map(
      document.nodes.map((node) => [node.part, node.rawText] as const),
    );
    expect(byPart.get("body")).toBe("Текст договора.");
    expect(byPart.get("header")).toBe("ООО «Демо-продукт»");
    expect(byPart.get("footer")).toBe("Стр. 1 из 10");
    expect(byPart.get("footnote")).toBe("Определение термина.");
    expect(byPart.get("comment")).toBe("Уточнить срок.");
  });
});

describe("tracked revisions (§12)", () => {
  test("an insertion is text and is reported as a revision", () => {
    const document = extract(
      docxWithBody({ body: trackedInsertion("приложение № 1") }),
    );
    const node = document.nodes[0];
    expect(node?.rawText).toBe("Основание: приложение № 1");
    expect(node?.revisions).toEqual([
      {
        type: "insert",
        author: "Reviewer",
        date: "2026-09-14T10:00:00Z",
        text: "приложение № 1",
      },
    ]);
    expect(document.counts.revisions).toBe(1);
  });

  test("a deletion is a revision and not part of the text", () => {
    const document = extract(
      docxWithBody({ body: trackedDeletion("10 дней") }),
    );
    const node = document.nodes[0];
    expect(node?.rawText).toBe("Срок: 30 дней");
    expect(node?.revisions?.[0]).toMatchObject({
      type: "delete",
      text: "10 дней",
      author: "Reviewer",
    });
  });

  test("a document with revisions is never silent about it", () => {
    const document = extract(
      docxWithBody({ body: trackedInsertion("условие") }),
    );
    expect(document.warnings.map((warning) => warning.code)).toContain(
      "TRACK_CHANGES_PRESENT",
    );
  });
});

describe("formatting signatures (§5.1 ignoreFormatting)", () => {
  test("a signature is collected only when formatting is compared", () => {
    const bytes = docxWithBody({ body: formatted("Текст.", ["b"]) });
    expect(
      extract(bytes, { ignoreFormatting: true }).nodes[0]?.formatting,
    ).toBe(undefined);
    expect(
      extract(bytes, { ignoreFormatting: false }).nodes[0]?.formatting,
    ).toBe("b");
    expect(
      extract(docxWithBody({ body: formatted("Текст.", ["b", "i"]) }), {
        ignoreFormatting: false,
      }).nodes[0]?.formatting,
    ).toBe("b,i");
  });
});

describe("refusals (§29, §42)", () => {
  test("a file that is not a package is a parse failure", () => {
    expect(codeOf(() => extract(Buffer.from("not a package", "utf8")))).toBe(
      "COMPARE_PARSE_FAILED",
    );
  });

  test("a package without a document part is a parse failure", () => {
    const bytes = docxWithBody({ body: paragraph("x") });
    const broken = Buffer.from(
      bytes.toString("latin1").replace("word/document.xml", "word/other.xml"),
      "latin1",
    );
    expect(codeOf(() => extract(broken))).toBe("COMPARE_PARSE_FAILED");
  });

  test("malformed XML is a parse failure, not a crash", () => {
    const bytes = docxWithBody({ body: "<w:p><w:r><w:t>незакрытый" });
    expect(codeOf(() => extract(bytes))).toBe("COMPARE_PARSE_FAILED");
  });

  test("a node budget stops a document that would flood the diff", () => {
    const body = Array.from({ length: 200 }, (_value, index) =>
      paragraph(`Пункт ${index}.`),
    ).join("");
    expect(
      codeOf(() => extract(docxWithBody({ body }), { maxNodes: 50 })),
    ).toBe("COMPARE_TOO_MANY_NODES");
  });

  test("an uncompressed budget stops a package that inflates past it", () => {
    const body = paragraph("А".repeat(5_000));
    expect(
      codeOf(() =>
        extract(docxWithBody({ body }), { maxUncompressedBytes: 500 }),
      ),
    ).toBe("COMPARE_PARSE_FAILED");
  });

  test("an external relationship is never followed", () => {
    const document = extract(
      docxWithBody({
        body: paragraph("Текст со ссылкой."),
        extra: {
          "word/_rels/document.xml.rels": externalRelationshipPart(
            "http://example.invalid/leak",
          ),
        },
      }),
    );
    expect(document.counts.nodes).toBe(1);
    expect(document.nodes[0]?.rawText).toBe("Текст со ссылкой.");
  });
});

describe("the OOXML reader (§42)", () => {
  test("entities and character references are decoded", () => {
    const root = parseXml("<a b='&lt;x&gt;'>A &amp; B &#1055; &#x41;</a>");
    const child = root.children[0];
    expect(child?.kind).toBe("element");
    if (child?.kind !== "element") throw new Error("no element");
    expect(child.name).toBe("a");
    expect(child.attributes.get("b")).toBe("<x>");
    const text = child.children[0];
    expect(text?.kind === "text" ? text.value : "").toBe("A & B П A");
  });

  test("comments, CDATA and declarations are handled", () => {
    const root = parseXml(
      '<?xml version="1.0"?><!--c--><a><![CDATA[<raw>]]></a>',
    );
    const child = root.children[0];
    if (child?.kind !== "element") throw new Error("no element");
    const text = child.children[0];
    expect(text?.kind === "text" ? text.value : "").toBe("<raw>");
  });

  test("a declared entity is never expanded", () => {
    // The declaration is skipped, and the reference that would use it is an
    // error: billion-laughs and XXE payloads cannot even be expressed.
    expect(() =>
      parseXml('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'),
    ).toThrow(XmlParseError);
    expect(() => parseXml("<a>&declared;</a>")).toThrow(XmlParseError);
    expect(parseXml("<!DOCTYPE a><a>ok</a>")).toBeDefined();
  });

  test("mismatched and unclosed tags are refused", () => {
    expect(() => parseXml("<a><b></a></b>")).toThrow(XmlParseError);
    expect(() => parseXml("<a><b>")).toThrow(XmlParseError);
  });

  test("deep nesting fails as a parse error, not as a stack overflow", () => {
    const deep = `${"<a>".repeat(600)}${"</a>".repeat(600)}`;
    expect(() => parseXml(deep)).toThrow(XmlParseError);
  });
});
