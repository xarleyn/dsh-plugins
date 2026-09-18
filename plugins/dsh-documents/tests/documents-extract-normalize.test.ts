import { describe, expect, test } from "vitest";

import { normalizeExtractedMarkdown } from "../src/documents/markdown/normalize.js";

describe("markdown normalization", () => {
  test("drops running heads repeated across pages", () => {
    const source = [
      "Отчёт о тестировании",
      "",
      "Первый абзац.",
      "",
      "Отчёт о тестировании",
      "",
      "Второй абзац.",
      "",
      "Отчёт о тестировании",
      "",
      "Третий абзац.",
      "",
    ].join("\n");
    const result = normalizeExtractedMarkdown(source);
    expect(result.markdown).not.toContain("Отчёт о тестировании");
    expect(result.markdown).toContain("Третий абзац.");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "TABLE_EXTRACTION_DEGRADED",
    );
  });

  test("keeps headings and tables intact and normalizes platform artifacts", () => {
    const source = "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n## Итог\r\n";
    const result = normalizeExtractedMarkdown(source);
    expect(result.markdown).toContain("| --- | --- |");
    expect(result.markdown).toContain("## Итог");
    expect(result.markdown).not.toContain("\r");
  });
});
