/**
 * Comparison security and limits (§26.2, §29, §30, §42).
 *
 * The comparison is the one document operation an agent can point at two
 * attacker-supplied files at once, so the tests here are the ones that matter
 * most: nothing outside the session scope is read, no container can make the
 * process allocate without bound, no input can make the plugin run something,
 * and every refusal is a code rather than a degraded answer.
 */

import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { buildZip, pdfBytes } from "./helpers/document-fixtures.js";
import { docxWithBody, paragraph } from "./helpers/comparison-fixtures.js";

import {
  compare,
  errorOf,
  runtime,
  workspace,
  write,
} from "./documents-comparison-security.helpers.js";

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
