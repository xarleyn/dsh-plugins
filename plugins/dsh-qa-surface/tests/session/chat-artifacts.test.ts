import { describe, expect, it } from "vitest";
import { artifactsOfToolResult } from "../../src/client/chat-artifacts.js";

/** One produced file as `document_create` renders it. */
const CREATED = [
  "artifact: doc_01ABC",
  "docx: .qa/artifacts/documents/doc_01ABC/report.docx (12.3 KiB, sha256 9f2c1d0a4b5e6f70…)",
  "pdf: .qa/artifacts/documents/doc_01ABC/report.pdf (88 KiB, sha256 1a2b3c4d5e6f7081…)",
  "template: qa-report",
  "source: .qa/artifacts/documents/doc_01ABC/source.md (1.1 KiB, sha256 0011223344556677…)",
  "manifest: .qa/artifacts/documents/doc_01ABC/manifest.json",
  "The artifact directory keeps the source, the assets and manifest.json beside the outputs.",
].join("\n");

describe("artifactsOfToolResult", () => {
  it("reads the produced formats out of a document_create result", () => {
    expect(artifactsOfToolResult("document_create", CREATED)).toEqual([
      {
        path: ".qa/artifacts/documents/doc_01ABC/report.docx",
        name: "report.docx",
        format: "docx",
        bytes: 12_595,
      },
      {
        path: ".qa/artifacts/documents/doc_01ABC/report.pdf",
        name: "report.pdf",
        format: "pdf",
        bytes: 90_112,
      },
    ]);
  });

  it("reads the extracted Markdown of an extraction result", () => {
    const output = [
      "artifact: ext_01ABC (extracted by docling)",
      "markdown: .qa/artifacts/documents/ext_01ABC/source.md",
      "assets: image-001.png",
      "---",
      "# Заголовок",
    ].join("\n");
    expect(artifactsOfToolResult("document_to_markdown", output)).toEqual([
      {
        path: ".qa/artifacts/documents/ext_01ABC/source.md",
        name: "source.md",
        format: "markdown",
        bytes: 0,
      },
    ]);
    // The bundle's own manifest line names no format the tool offers to the user.
    expect(artifactsOfToolResult("document_to_markdown", CREATED)).toEqual([]);
  });

  it("skips a format that failed, and a tool that produces nothing", () => {
    const partial = [
      "artifact: doc_01ABC",
      "docx: .qa/artifacts/documents/doc_01ABC/report.docx (12.3 KiB, sha256 9f2c…)",
      "pdf: failed (CONVERSION_FAILED)",
    ].join("\n");
    expect(artifactsOfToolResult("document_convert", partial)).toHaveLength(1);
    expect(artifactsOfToolResult("read", CREATED)).toEqual([]);
    expect(artifactsOfToolResult("document_create", null)).toEqual([]);
  });

  it("refuses to card a path spelled from the filesystem root", () => {
    // A tool that reported an absolute path would name the account's own
    // directory; the workspace fence would refuse the read and the card would
    // promise an action that cannot be performed.
    const leaked = [
      "artifact: doc_01ABC",
      "docx: /workspace/work/.qa-users/6f2a/report.docx (12.3 KiB, sha256 9f2c…)",
      "pdf: C:\\workspace\\report.pdf (1 KiB, sha256 9f2c…)",
    ].join("\n");
    expect(artifactsOfToolResult("document_create", leaked)).toEqual([]);
  });

  it("ignores prose that only mentions a file", () => {
    const prose = [
      "Документ report.docx создан.",
      "docx: готов",
      "document_create: done",
    ].join("\n");
    expect(artifactsOfToolResult("document_create", prose)).toEqual([]);
  });
});
