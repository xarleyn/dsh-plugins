/**
 * Comparison security and limits (§26.2, §29, §30, §42).
 *
 * The comparison is the one document operation an agent can point at two
 * attacker-supplied files at once, so the tests here are the ones that matter
 * most: nothing outside the session scope is read, no container can make the
 * process allocate without bound, no input can make the plugin run something,
 * and every refusal is a code rather than a degraded answer.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { buildZip, pdfBytes } from "./helpers/document-fixtures.js";
import {
  docxWithBody,
  externalRelationshipPart,
  paragraph,
} from "./helpers/comparison-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

let workspace: string;

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-compare-sec-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runtime(
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
  options: { readonly clock?: () => Date } = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(config),
    providers: stubProviderSet().providers,
    now: options.clock ?? (() => new Date("2026-09-14T10:00:00Z")),
  });
}

function exec(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: workspace, id: "session-1" } } },
  } as unknown as ToolRunContext;
}

async function compare(
  instance: DocumentRuntime,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const definition = createDocumentTools({ runtime: instance }).find(
    (entry) => entry.name === "document_compare",
  );
  if (definition === undefined) throw new Error("document_compare is missing");
  return (await definition.execute({ left, right }, exec())) as Record<
    string,
    unknown
  >;
}

async function errorOf(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    if (error instanceof DocumentError) return error.code;
    throw error;
  }
  throw new Error("the call did not fail");
}

async function write(name: string, content: string | Buffer): Promise<string> {
  const target = path.join(workspace, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return name;
}

describe("path containment (§26.2)", () => {
  test("a traversal path never leaves the workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "qa-docs-outside-"));
    await writeFile(path.join(outside, "secret.md"), "секрет", "utf8");
    await write("inside.md", "Текст.");
    try {
      const instance = runtime();
      expect(
        await errorOf(() =>
          compare(
            instance,
            { path: path.join("..", path.basename(outside), "secret.md") },
            { path: "inside.md" },
          ),
        ),
      ).toBe("FILE_NOT_FOUND");
      expect(
        await errorOf(() =>
          compare(
            instance,
            { path: path.join(outside, "secret.md") },
            { path: "inside.md" },
          ),
        ),
      ).toBe("FILE_NOT_FOUND");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a file URL is refused as a path", async () => {
    await write("inside.md", "Текст.");
    const instance = runtime();
    // Anywhere else in the pipeline the same reference answers FILE_NOT_FOUND:
    // the URL is refused as a path, and never resolved as one.
    expect(
      await errorOf(() =>
        compare(
          instance,
          { path: "file:///etc/passwd" },
          { path: "inside.md" },
        ),
      ),
    ).toBe("FILE_NOT_FOUND");
  });

  test("a symlink out of the workspace is not followed", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "qa-docs-outside-"));
    await writeFile(path.join(outside, "secret.md"), "секрет", "utf8");
    await write("inside.md", "Текст.");
    try {
      await symlink(outside, path.join(workspace, "escape"), "dir").catch(
        () => undefined,
      );
      const instance = runtime();
      const code = await errorOf(() =>
        compare(instance, { path: "escape/secret.md" }, { path: "inside.md" }),
      );
      expect(["FILE_NOT_FOUND", "PATH_NOT_ALLOWED"]).toContain(code);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a reference must name exactly one of path or artifactId", async () => {
    await write("inside.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() => compare(instance, {}, { path: "inside.md" })),
    ).toBe("INVALID_INPUT");
    expect(
      await errorOf(() =>
        compare(
          instance,
          { path: "inside.md", artifactId: "doc_01K51GQ7V18R3PQ9J11A87AVFB" },
          { path: "inside.md" },
        ),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await errorOf(() =>
        compare(
          instance,
          { artifactId: "cmp_01K51GQ7V18R3PQ9J11A87AVFB" },
          { path: "inside.md" },
        ),
      ),
    ).toBe("COMPARE_ARTIFACT_NOT_FOUND");
  });
});

describe("input refusals (§26.3, §26.6, §29)", () => {
  test("a macro-enabled document is refused", async () => {
    await write("plain.md", "Текст.");
    const instance = runtime();
    // A DOCM is recognized by its VBA part, and refused before extraction —
    // the macro is never read, let alone run.
    await write(
      "macro.docm",
      docxWithBody({
        body: paragraph("Текст."),
        extra: { "word/vbaProject.bin": Buffer.from("macro", "utf8") },
      }),
    );
    expect(
      await errorOf(() =>
        compare(instance, { path: "macro.docm" }, { path: "plain.md" }),
      ),
    ).toBe("MACRO_ENABLED_DOCUMENT");
  });

  test("an encrypted OOXML container is refused", async () => {
    // An encrypted Office file is an OLE/CFB container, not a ZIP one.
    const cfb = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    await write("encrypted.docx", cfb);
    await write("plain.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() =>
        compare(instance, { path: "encrypted.docx" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_ENCRYPTED_DOCUMENT");
  });

  test("an encrypted PDF is refused", async () => {
    await write("encrypted.pdf", pdfBytes({ encrypted: true }));
    await write("plain.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() =>
        compare(instance, { path: "encrypted.pdf" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_ENCRYPTED_DOCUMENT");
  });

  test("an unsupported container is refused with a format code", async () => {
    // An OOXML package that is not a word-processing document: a spreadsheet
    // is a ZIP with the same content types, and it is not comparable here.
    await write(
      "table.xlsx",
      buildZip([{ name: "xl/workbook.xml", data: "<workbook/>" }]),
    );
    await write("plain.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() =>
        compare(instance, { path: "table.xlsx" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_UNSUPPORTED_FORMAT");
  });

  test("an oversized input is refused before it is parsed", async () => {
    await write("big.md", "А".repeat(5_000));
    await write("plain.md", "Текст.");
    const instance = runtime({
      comparison: { maxInputBytes: 1_024 },
    });
    expect(
      await errorOf(() =>
        compare(instance, { path: "big.md" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_INPUT_TOO_LARGE");
  });

  test("a document with no extractable text is a quality failure", async () => {
    await write("empty.md", "\n\n");
    await write("plain.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() =>
        compare(instance, { path: "empty.md" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_LOW_EXTRACTION_QUALITY");
  });

  test("a comparison is never allowed to produce an endless change set", async () => {
    await write("before.md", "Первый.\n\nВторой.\n");
    await write("after.md", "Первый!\n\nВторой!\n");
    const instance = runtime({ comparison: { maxChanges: 1 } });
    expect(
      await errorOf(() =>
        compare(instance, { path: "before.md" }, { path: "after.md" }),
      ),
    ).toBe("COMPARE_DIFF_LIMIT_EXCEEDED");
  });

  test("a comparison that runs out of time is reported, not guessed", async () => {
    await write("before.md", "# Раздел\n\nТекст 1.\n");
    await write("after.md", "# Раздел\n\nТекст 2.\n");
    let tick = 0;
    const instance = runtime(
      { comparison: { timeoutMs: 1_000 } },
      {
        clock: () => {
          tick += 5_000;
          return new Date(Date.UTC(2026, 8, 14) + tick);
        },
      },
    );
    expect(
      await errorOf(() =>
        compare(instance, { path: "before.md" }, { path: "after.md" }),
      ),
    ).toBe("COMPARE_TIMEOUT");
  });

  test("a malformed package fails as a parse error", async () => {
    await write(
      "broken.docx",
      docxWithBody({ body: "<w:p><w:r><w:t>незакрытый" }),
    );
    await write("plain.md", "Текст.");
    const instance = runtime();
    expect(
      await errorOf(() =>
        compare(instance, { path: "broken.docx" }, { path: "plain.md" }),
      ),
    ).toBe("COMPARE_PARSE_FAILED");
  });
});

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
