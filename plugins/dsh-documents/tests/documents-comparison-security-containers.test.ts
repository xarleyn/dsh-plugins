import { describe, expect, test, vi } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  docxWithBody,
  externalRelationshipPart,
  paragraph,
} from "./helpers/comparison-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import {
  compare,
  errorOf,
  runtime,
  write,
} from "./documents-comparison-security.helpers.js";

describe("hostile containers (§42)", () => {
  test("a ZIP bomb is refused instead of inflated", async () => {
    // Declared sizes are the archive's claim; the entry cap is what stops an
    // archive whose real expansion is orders of magnitude larger.
    const bomb = docxWithBody({
      body: paragraph("А".repeat(40 * 1024 * 1024)),
    });
    await write("bomb.docx", bomb);
    await write("plain.md", "Текст.");
    const instance = runtime({
      comparison: {
        maxUncompressedBytes: 1_048_576,
        maxInputBytes: 200_000_000,
      },
    });
    expect(
      await errorOf(() =>
        compare(instance, { path: "bomb.docx" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_PARSE_FAILED");
  }, 60_000);

  test("a document with a huge number of nodes is refused", async () => {
    const body = Array.from({ length: 5_000 }, (_value, index) =>
      paragraph(`Пункт ${index}.`),
    ).join("");
    await write("huge.docx", docxWithBody({ body }));
    await write("plain.md", "Текст.");
    const instance = runtime({ comparison: { maxNodes: 100 } });
    expect(
      await errorOf(() =>
        compare(instance, { path: "huge.docx" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_TOO_MANY_NODES");
  }, 60_000);

  test("no comparison opens a socket, even for an external relationship", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("the comparison must not perform network I/O");
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await write(
        "rel.docx",
        docxWithBody({
          body: paragraph("Текст со ссылкой."),
          extra: {
            "word/_rels/document.xml.rels": externalRelationshipPart(
              "http://example.invalid/leak",
            ),
          },
        }),
      );
      await write(
        "rel2.docx",
        docxWithBody({ body: paragraph("Другой текст.") }),
      );
      const instance = runtime();
      const result = await compare(
        instance,
        { path: "rel.docx" },
        { path: "rel2.docx" },
      );
      expect(result.status).toBe("completed");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a comparison of native formats never reaches for a backend", async () => {
    // DOCX and Markdown are read in-process, so no renderer, extractor or
    // converter may be touched — which is also what keeps the comparison free
    // of any process the plugin might otherwise spawn. The build-time half of
    // this claim (no `child_process` reachable from the comparison modules) is
    // pinned by the package verification script.
    const stub = stubProviderSet();
    const instance = new DocumentRuntime({
      config: resolveDocumentsConfig({}),
      providers: stub.providers,
      now: () => new Date("2026-09-14T10:00:00Z"),
    });
    await write("a.docx", docxWithBody({ body: paragraph("Раз.") }));
    await write("b.docx", docxWithBody({ body: paragraph("Два.") }));
    const result = await compare(
      instance,
      { path: "a.docx" },
      { path: "b.docx" },
    );
    expect(result.status).toBe("completed");
    expect(stub.calls.docx).toHaveLength(0);
    expect(stub.calls.pdf).toHaveLength(0);
    expect(stub.calls.convert).toHaveLength(0);
    expect(stub.calls.extract).toHaveLength(0);
  });
});
