import { describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";

describe("comparison configuration (§30, §31)", () => {
  test("resolves the documented defaults", () => {
    const config = resolveDocumentsConfig({});
    expect(config.comparison).toEqual({
      enabled: true,
      defaultMode: "contract",
      detectMoves: true,
      includeHeaders: true,
      includeFooters: true,
      includeFootnotes: true,
      includeComments: false,
      ignoreWhitespace: true,
      ignoreFormatting: true,
      maxInputBytes: 52_428_800,
      maxNodes: 100_000,
      maxChanges: 50_000,
      maxUncompressedBytes: 268_435_456,
      timeoutMs: 120_000,
      inlineChanges: 20,
      inlineTextCharsPerChange: 4_000,
      defaultLimit: 20,
      maxLimit: 200,
      retainNormalizedDocuments: true,
    });
  });

  test("accepts the operators' values and normalizes the mode", () => {
    const config = resolveDocumentsConfig({
      comparison: {
        enabled: false,
        defaultMode: "default",
        detectMoves: false,
        includeComments: true,
        maxChanges: 10,
        pageSize: 5,
      },
    });
    expect(config.comparison).toMatchObject({
      enabled: false,
      defaultMode: "default",
      detectMoves: false,
      includeComments: true,
      maxChanges: 10,
      defaultLimit: 5,
    });
  });

  test("refuses impossible budgets and unknown modes", () => {
    const codes = [
      () => resolveDocumentsConfig({ comparison: { maxChanges: 0 } }),
      () => resolveDocumentsConfig({ comparison: { timeoutMs: 10 } }),
      () =>
        resolveDocumentsConfig({
          comparison: { defaultMode: "whatever" as never },
        }),
    ];
    for (const build of codes) {
      expect(() => build()).toThrow(DocumentError);
    }
  });
});
