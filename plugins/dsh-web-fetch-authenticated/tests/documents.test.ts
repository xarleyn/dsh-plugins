/**
 * Attachment text extraction (SPEC §15.3): the classifier, the office-document
 * readers, and the fetch path end to end — what the model receives when it
 * asks for an attachment URL instead of a page.
 */

import { afterEach, describe, expect, test } from "vitest";

import { AuthenticatedFetchProvider } from "../src/provider.js";
import {
  classifyDocumentTarget,
  extractDocument,
  filenameOf,
} from "../src/documents/extract.js";
import { extractOfficeText } from "../src/documents/ooxml.js";
import {
  configWith,
  fakeCredentials,
  fixtureRule,
  startFixture,
  type FixtureServer,
} from "./helpers.js";
import { buildDocx, buildOdt } from "./docx-fixture.js";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import type { AuthenticatedFetchRule } from "../src/types.js";

function silentLogger(): PluginLogger {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger(),
    level: "error",
    setLevel: () => {},
  } as unknown as PluginLogger;
}

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCX_BODY = [
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Регламент</w:t></w:r></w:p>',
  "<w:p><w:r><w:t>Одна основная ветка.</w:t></w:r></w:p>",
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Первое правило</w:t></w:r></w:p>',
  "<w:p><w:r><w:t>Правило с </w:t></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>полем</w:t></w:r></w:p>",
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Шаг</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Команда</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>git fetch</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
].join("");

describe("document target classification", () => {
  test("a Word media type is extractable whatever the URL says", () => {
    expect(
      classifyDocumentTarget(
        "https://w.corp/download/7/file?api=v2",
        DOCX_MEDIA_TYPE,
      ),
    ).toEqual({
      extractable: true,
      format: "docx",
      filename: "file",
    });
  });

  test("Confluence's octet-stream download resolves through the extension", () => {
    const target = classifyDocumentTarget(
      "https://w.corp/wiki/download/attachments/7/%D0%A0%D0%B5%D0%B3%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82.docx?api=v2",
      "application/octet-stream",
    );
    expect(target).toMatchObject({ extractable: true, format: "docx" });
    expect(target !== undefined && target.filename).toBe("Регламент.docx");
  });

  test("a PDF is refused with a reason the model can act on", () => {
    const target = classifyDocumentTarget(
      "https://w.corp/download/7/report.pdf",
      "application/pdf",
    );
    expect(target?.extractable).toBe(false);
    expect(
      target !== undefined && !target.extractable && target.reason,
    ).toContain(".pdf format is not extracted");
  });

  test("a non-document response stays unclassified", () => {
    expect(
      classifyDocumentTarget(
        "https://w.corp/wiki/pages/viewpage.action",
        "text/html",
      ),
    ).toBeUndefined();
    // An archive is a binary the model cannot read either, so it is refused
    // with the same kind of explanation as a PDF.
    expect(
      classifyDocumentTarget("https://w.corp/archive.zip", "application/zip")
        ?.extractable,
    ).toBe(false);
  });

  test("the filename comes from the last path segment", () => {
    expect(filenameOf("https://w.corp/a/b/c%20d.docx?x=1")).toBe("c d.docx");
    expect(filenameOf("not a url")).toBe("");
  });
});

describe("office document text", () => {
  test("a DOCX body becomes headings, paragraphs, list items and a table", () => {
    const extracted = extractOfficeText(buildDocx(DOCX_BODY), {
      maxPartBytes: 1_000_000,
      maxChars: 10_000,
    });
    expect(extracted?.format).toBe("docx");
    const markdown = extracted?.markdown ?? "";
    expect(markdown).toContain("# Регламент");
    expect(markdown).toContain("Одна основная ветка.");
    expect(markdown).toContain("- Первое правило");
    expect(markdown).toContain("| Шаг | Команда |");
    expect(markdown).toContain("| 1 | git fetch |");
  });

  test("field codes are dropped, not read as text", () => {
    const extracted = extractOfficeText(buildDocx(DOCX_BODY), {
      maxPartBytes: 1_000_000,
      maxChars: 10_000,
    });
    // "Правило с полем": the PAGE field between the runs leaves no trace.
    expect(extracted?.markdown).toContain("Правило с полем");
    expect(extracted?.markdown).not.toContain("PAGE");
  });

  test("an ODT body becomes a heading, a paragraph and a list item", () => {
    const extracted = extractOfficeText(
      buildOdt(
        '<text:h text:outline-level="1">Заголовок</text:h>' +
          "<text:p>Простой текст</text:p>" +
          "<text:list><text:list-item><text:p>Пункт списка</text:p></text:list-item></text:list>",
      ),
      { maxPartBytes: 1_000_000, maxChars: 10_000 },
    );
    expect(extracted?.format).toBe("odt");
    expect(extracted?.markdown).toContain("# Заголовок");
    expect(extracted?.markdown).toContain("Простой текст");
    expect(extracted?.markdown).toContain("- Пункт списка");
  });

  test("the char cap truncates the text and says so", () => {
    const extracted = extractOfficeText(buildDocx(DOCX_BODY), {
      maxPartBytes: 1_000_000,
      maxChars: 20,
    });
    expect(extracted?.truncated).toBe(true);
    expect(extracted?.markdown.length).toBe(20);
  });

  test("bytes that are not an office archive yield nothing", () => {
    expect(
      extractOfficeText(new TextEncoder().encode("<html>nope</html>"), {
        maxPartBytes: 1_000_000,
        maxChars: 1_000,
      }),
    ).toBeUndefined();
  });

  test("the document seam carries a provenance line", () => {
    const extracted = extractDocument({
      bytes: buildDocx(DOCX_BODY),
      filename: "Регламент.docx",
      format: "docx",
      maxPartBytes: 1_000_000,
      maxChars: 10_000,
    });
    expect(extracted?.content).toContain(
      "_[attachment text extracted: Регламент.docx (DOCX,",
    );
    expect(extracted?.content).toContain("# Регламент");
  });
});

describe("fetching an attachment through the provider", () => {
  let server: FixtureServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  function providerFor(
    rule: AuthenticatedFetchRule,
  ): AuthenticatedFetchProvider {
    return new AuthenticatedFetchProvider({
      configSource: () => configWith([rule]),
      credentials: fakeCredentials({ TEST_TOKEN: "secret" }),
      logger: silentLogger(),
    });
  }

  function attachmentRule(
    overrides: Parameters<typeof fixtureRule>[1] = {},
  ): ReturnType<typeof fixtureRule> {
    return fixtureRule(server!.origin, {
      match: {
        schemes: ["http"],
        hosts: ["127.0.0.1"],
        ports: [server!.port],
        allowPaths: ["/download/**"],
      },
      ...overrides,
    });
  }

  test("a DOCX attachment is served as its extracted text", async () => {
    const docx = buildDocx(DOCX_BODY);
    server = await startFixture(
      {},
      {
        bodyBytes: docx,
        headers: { "content-type": DOCX_MEDIA_TYPE },
      },
    );
    const result = await providerFor(attachmentRule()).fetch({
      url: `${server.origin}/download/attachments/7/Регламент.docx?api=v2`,
    });
    expect(result.body.kind).toBe("text");
    expect(result.body.content).toContain("# Регламент");
    expect(result.body.content).toContain("git fetch");
    expect(result.truncated).toBe(false);
  });

  test("extraction off keeps the plain unsupported-content refusal", async () => {
    server = await startFixture(
      {},
      {
        body: "binary",
        headers: { "content-type": DOCX_MEDIA_TYPE },
      },
    );
    const rule = attachmentRule({ documents: { enabled: false } });
    await expect(
      providerFor(rule).fetch({
        url: `${server.origin}/download/attachments/7/Регламент.docx`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_FETCH_UNSUPPORTED_CONTENT" });
  });

  test("a document over the configured cap is refused with its own code", async () => {
    const docx = buildDocx(DOCX_BODY);
    server = await startFixture(
      {},
      {
        bodyBytes: docx,
        headers: {
          "content-type": DOCX_MEDIA_TYPE,
          "content-length": String(docx.byteLength),
        },
      },
    );
    const rule = attachmentRule({ documents: { maxBytes: 16 } });
    await expect(
      providerFor(rule).fetch({
        url: `${server.origin}/download/attachments/7/Регламент.docx`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_FETCH_DOCUMENT_TOO_LARGE" });
  });

  test("the char cap truncates what reaches the model", async () => {
    const docx = buildDocx(DOCX_BODY);
    server = await startFixture(
      {},
      {
        bodyBytes: docx,
        headers: { "content-type": DOCX_MEDIA_TYPE },
      },
    );
    const rule = attachmentRule({ documents: { maxChars: 40 } });
    const result = await providerFor(rule).fetch({
      url: `${server.origin}/download/attachments/7/Регламент.docx`,
    });
    expect(result.truncated).toBe(true);
    expect(result.body.content).toContain("_[text truncated at 40 characters");
  });

  test("a PDF is refused by name, not by content type", async () => {
    server = await startFixture(
      {},
      {
        body: "%PDF-1.7",
        headers: { "content-type": "application/pdf" },
      },
    );
    const failure = (await providerFor(attachmentRule())
      .fetch({ url: `${server.origin}/download/attachments/7/report.pdf` })
      .then(
        () => undefined,
        (error: unknown) => error as { code?: string; message?: string },
      )) as { code?: string; message?: string };
    expect(failure.code).toBe("AUTH_FETCH_DOCUMENT_UNREADABLE");
    expect(failure.message).toContain("report.pdf");
  });

  test("bytes that only claim to be a document are refused", async () => {
    server = await startFixture(
      {},
      {
        body: "<html>login page</html>",
        headers: { "content-type": DOCX_MEDIA_TYPE },
      },
    );
    await expect(
      providerFor(attachmentRule()).fetch({
        url: `${server.origin}/download/attachments/7/Регламент.docx`,
      }),
    ).rejects.toMatchObject({ code: "AUTH_FETCH_DOCUMENT_UNREADABLE" });
  });
});
