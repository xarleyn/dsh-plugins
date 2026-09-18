import { expect } from "vitest";

import type { CanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import { canonicalFromMarkdown } from "../src/documents/comparison/extractors/markdown.js";
import { diffDocuments } from "../src/documents/comparison/diff/block-diff.js";
import type { DocumentChange } from "../src/documents/comparison/types.js";

export const MAX_NODES = 10_000;

export function markdownDocument(text: string): CanonicalDocument {
  return canonicalFromMarkdown(text, { maxNodes: MAX_NODES });
}

export function compare(
  left: string,
  right: string,
  options: {
    detectMoves?: boolean;
    ignoreWhitespace?: boolean;
    ignoreFormatting?: boolean;
    confidence?: number;
  } = {},
): DocumentChange[] {
  return diffDocuments(markdownDocument(left), markdownDocument(right), {
    leftSha: "left-sha",
    rightSha: "right-sha",
    detectMoves: options.detectMoves ?? true,
    ignoreWhitespace: options.ignoreWhitespace ?? true,
    ignoreFormatting: options.ignoreFormatting ?? true,
    confidence: options.confidence ?? 1,
    checkBudget: () => undefined,
  });
}

export function only(changes: readonly DocumentChange[]): DocumentChange {
  expect(changes).toHaveLength(1);
  return changes[0] as DocumentChange;
}
