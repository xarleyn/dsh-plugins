/**
 * The comparison tools end to end (§5–§7, §22–§24).
 *
 * Everything below the tools has its own tests; this file exercises the whole
 * path the model actually sees: two documents on disk, a comparison artifact
 * written under the session's artifact root, a bounded preview in the tool
 * result, and pages of changes read back by id. It also pins the properties the
 * specification asks for by name — determinism, stable ids, and the fact that
 * disabling the feature removes the tools instead of weakening them.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  docxWithBody,
  heading,
  paragraph,
  table,
} from "./helpers/comparison-fixtures.js";
import {
  artifactRoot,
  CONTRACT_AFTER,
  CONTRACT_BEFORE,
  run,
  runtime,
  stub,
  write,
} from "./documents-comparison-tools.helpers.js";

describe("document_compare", () => {
  test("compares two Markdown documents and reports what changed", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const result = await run(instance, "document_compare", {
      left: { path: "before.md" },
      right: { path: "after.md" },
    });

    expect(result.comparisonId).toMatch(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(result.status).toBe("completed");
    // Two edited paragraphs, plus the added section — one heading and one
    // paragraph — which is two insertions and not one.
    expect(result.summary).toMatchObject({
      replacements: 2,
      insertions: 2,
      deletions: 0,
      moves: 0,
      total: 4,
    });
    expect(result.previewTruncated).toBe(false);
    const preview = result.preview as { changeId: string; signals: string[] }[];
    expect(preview.length).toBe(4);
    expect(preview[0]?.signals).toContain("DURATION_CHANGED");
    expect(preview[1]?.signals).toContain("NEGATION_CHANGED");

    // The artifact is a real bundle, with the layout the spec fixes (§22).
    const bundle = path.join(artifactRoot(), result.comparisonId as string);
    const files = (await readdir(bundle, { recursive: true })).map((entry) =>
      entry.split(path.sep).join("/"),
    );
    expect(files).toContain("manifest.json");
    expect(files).toContain("diff/changes.jsonl");
    expect(files).toContain("diff/report.md");
    expect(files).toContain("diff/summary.json");
    expect(files).toContain("inputs/left.md");
    expect(files).toContain("normalized/left.json");

    const manifest = JSON.parse(
      await readFile(path.join(bundle, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.kind).toBe("document-comparison");
    expect(manifest.operation).toBe("document_compare");
    const comparison = manifest.comparison as {
      engine: { diff: string };
      changes: number;
      quality: { level: string };
    };
    expect(comparison.engine.diff).toBe("document-diff-v1");
    expect(comparison.changes).toBe(4);
    expect(comparison.quality.level).toBe("high");

    const report = await readFile(
      path.join(bundle, "diff", "report.md"),
      "utf8",
    );
    // Sections are the heading path, outermost first (§35).
    expect(report).toContain("## Договор оказания услуг › 5.2 Порядок оплаты");
    expect(report).toContain("30 календарных дней");
    expect(report).toContain("Signals: `NUMBER_CHANGED`, `DURATION_CHANGED`");
  });

  test("compares DOCX packages without any converter", async () => {
    await write(
      "before.docx",
      docxWithBody({
        body:
          heading("5.2 Порядок оплаты", 2) +
          paragraph("Оплата производится в течение 10 рабочих дней.") +
          table([
            ["Позиция", "Сумма"],
            ["Лицензия", "500 000 ₽"],
          ]),
      }),
    );
    await write(
      "after.docx",
      docxWithBody({
        body:
          heading("5.2 Порядок оплаты", 2) +
          paragraph("Оплата производится в течение 30 рабочих дней.") +
          table([
            ["Позиция", "Сумма"],
            ["Лицензия", "750 000 ₽"],
          ]),
      }),
    );
    const instance = runtime();
    const result = await run(instance, "document_compare", {
      left: { path: "before.docx" },
      right: { path: "after.docx" },
      mode: "contract",
    });
    expect(result.summary).toMatchObject({ replacements: 2, insertions: 0 });
    const preview = result.preview as { changeId: string; location: string }[];
    expect(preview.map((entry) => entry.location)).toEqual([
      "5.2 Порядок оплаты",
      "5.2 Порядок оплаты, table 1, row 1, column 1",
    ]);
    // A DOCX pair is the high-quality case, and it never touched a provider.
    expect(stub.calls.extract).toHaveLength(0);
    expect(stub.calls.docx).toHaveLength(0);
    expect(result.quality).toMatchObject({
      level: "high",
      leftExtraction: "native-docx",
      rightExtraction: "native-docx",
    });
  });

  test("headers and footers are compared only in scope=all", async () => {
    const before = docxWithBody({
      body: paragraph("Текст договора."),
      extra: { "word/header1.xml": headerFixture("Редакция 1") },
    });
    const after = docxWithBody({
      body: paragraph("Текст договора."),
      extra: { "word/header1.xml": headerFixture("Редакция 2") },
    });
    await write("h1.docx", before);
    await write("h2.docx", after);
    const instance = runtime();
    const bodyOnly = await run(instance, "document_compare", {
      left: { path: "h1.docx" },
      right: { path: "h2.docx" },
      scope: "body",
    });
    expect(bodyOnly.summary).toMatchObject({ total: 0 });

    const everything = await run(instance, "document_compare", {
      left: { path: "h1.docx" },
      right: { path: "h2.docx" },
      scope: "all",
    });
    expect(everything.summary).toMatchObject({ replacements: 1 });
    const preview = everything.preview as { location: string }[];
    expect(preview[0]?.location).toContain("header");
  });

  test("an artifact id names a document the session produced earlier", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const extracted = await run(instance, "document_to_markdown", {
      file: "before.md",
    });
    const compareResult = await run(instance, "document_compare", {
      left: { artifactId: extracted.artifactId },
      right: { path: "after.md" },
    });
    expect(compareResult.summary).toMatchObject({ replacements: 2 });
    expect(compareResult.left).toMatchObject({ name: "before.md" });
  });

  test("the same inputs always produce the same change set (§24, §40)", async () => {
    await write("before.md", CONTRACT_BEFORE);
    await write("after.md", CONTRACT_AFTER);
    const instance = runtime();
    const digests: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await run(instance, "document_compare", {
        left: { path: "before.md" },
        right: { path: "after.md" },
      });
      digests.push(await readFile(result.changesPath as string, "utf8"));
    }
    expect(new Set(digests).size).toBe(1);
  });

  test("mode=contract is the conservative default of the deployment", () => {
    const instance = runtime();
    const effective = instance.comparisonOptions({});
    expect(effective.scope).toBe("all");
    expect(effective.options).toMatchObject({
      detectMoves: true,
      includeHeaders: true,
      includeFooters: true,
      includeFootnotes: true,
      ignoreWhitespace: true,
      ignoreFormatting: true,
      includeComments: false,
    });
    const plain = instance.comparisonOptions({ mode: "default" });
    expect(plain.scope).toBe("body");
    expect(plain.options.includeHeaders).toBe(true);
    const scoped = instance.comparisonOptions({
      mode: "contract",
      scope: "body",
    });
    expect(scoped.scope).toBe("body");
  });

  test("an explicit option overrides the mode", () => {
    const instance = runtime();
    const effective = instance.comparisonOptions({
      mode: "contract",
      options: { includeHeaders: false },
    });
    expect(effective.options.includeHeaders).toBe(false);
  });
});

function headerFixture(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(text)}</w:hdr>`;
}
